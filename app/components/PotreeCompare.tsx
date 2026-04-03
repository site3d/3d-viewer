"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "./PotreeCompare.module.css";

const DEFAULT_LEFT = "/api/pointclouds/lion_takanawa/cloud.js";
const DEFAULT_RIGHT = "/api/pointclouds/lion_takanawa/cloud.js";

const POTREE_CSS = [
  "/potree/libs/jquery-ui/jquery-ui.min.css",
  "/potree/libs/openlayers3/ol.css",
  "/potree/libs/spectrum/spectrum.css",
  "/potree/libs/jstree/themes/mixed/style.css",
  "/potree/build/potree/potree.css",
];

const POTREE_SCRIPTS = [
  "/potree/libs/jquery/jquery-3.1.1.min.js",
  "/potree/libs/spectrum/spectrum.js",
  "/potree/libs/jquery-ui/jquery-ui.min.js",
  "/potree/libs/other/BinaryHeap.js",
  "/potree/libs/tween/tween.min.js",
  "/potree/libs/d3/d3.js",
  "/potree/libs/proj4/proj4.js",
  "/potree/libs/openlayers3/ol.js",
  "/potree/libs/i18next/i18next.js",
  "/potree/libs/jstree/jstree.js",
  "/potree/libs/copc/index.js",
  "/potree/build/potree/potree.js",
  "/potree/libs/plasio/js/laslaz.js",
];

type VisualMode = "elevation" | "rgba" | "intensity";

type PointcloudProject = {
  id: string;
  name: string;
  defaultUrl: string | null;
  cloudJsUrl: string | null;
  eptJsonUrl: string | null;
};

type ViewerInstance = {
  scene: {
    view: unknown;
    pointclouds: unknown[];
    addPointCloud: (pc: unknown) => void;
  };
  controls: { enabled: boolean };
  setEDLEnabled: (v: boolean) => void;
  setFOV: (v: number) => void;
  setPointBudget: (n: number) => void;
  setBackground: (s: string) => void;
  fitToScreen: () => void;
  addEventListener: (t: string, fn: () => void) => void;
  removeEventListener: (t: string, fn: () => void) => void;
  renderer: { setAnimationLoop: (fn: ((t: number) => void) | null) => void };
};

function loadCss(href: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("link");
    s.rel = "stylesheet";
    s.href = href;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(href));
    document.head.appendChild(s);
  });
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(src));
    document.head.appendChild(s);
  });
}

function copyView(
  from: { position: { copy: (v: unknown) => void }; yaw: number; pitch: number; radius: number },
  to: { position: { copy: (v: unknown) => void }; yaw: number; pitch: number; radius: number },
) {
  to.position.copy(from.position);
  to.yaw = from.yaw;
  to.pitch = from.pitch;
  to.radius = from.radius;
}

function viewSnapshot(view: { position: { x: number; y: number; z: number }; yaw: number; pitch: number; radius: number }) {
  return {
    x: view.position.x,
    y: view.position.y,
    z: view.position.z,
    yaw: view.yaw,
    pitch: view.pitch,
    radius: view.radius,
  };
}

function isSameView(
  a: ReturnType<typeof viewSnapshot>,
  b: ReturnType<typeof viewSnapshot>,
  eps = 1e-7,
) {
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.z - b.z) < eps &&
    Math.abs(a.yaw - b.yaw) < eps &&
    Math.abs(a.pitch - b.pitch) < eps &&
    Math.abs(a.radius - b.radius) < eps
  );
}

function applyVisual(
  pc: {
    getAttribute: (n: string) => unknown;
    material: {
      activeAttributeName: string;
      size: number;
      pointSizeType: number;
      shape: number;
    };
  },
  mode: VisualMode,
  Potree: { PointSizeType: { ADAPTIVE: number }; PointShape: { SQUARE: number } },
) {
  const m = pc.material;
  m.size = 1;
  m.pointSizeType = Potree.PointSizeType.ADAPTIVE;
  m.shape = Potree.PointShape.SQUARE;
  if (mode === "intensity" && !pc.getAttribute("intensity")) {
    m.activeAttributeName = "rgba";
    return;
  }
  if (mode === "elevation") m.activeAttributeName = "elevation";
  else if (mode === "intensity") m.activeAttributeName = "intensity";
  else m.activeAttributeName = "rgba";
}

export default function PotreeCompare() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftViewerRef = useRef<ViewerInstance | null>(null);
  const rightViewerRef = useRef<ViewerInstance | null>(null);

  const lockedRef = useRef(true);
  const lastTouchedRef = useRef<"left" | "right">("left");

  const [scriptsReady, setScriptsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const [split, setSplit] = useState(0.5);
  const dragging = useRef(false);

  const [urlLeft, setUrlLeft] = useState(DEFAULT_LEFT);
  const [urlRight, setUrlRight] = useState(DEFAULT_RIGHT);
  const [modeLeft, setModeLeft] = useState<VisualMode>("elevation");
  const [modeRight, setModeRight] = useState<VisualMode>("rgba");
  const [loadKey, setLoadKey] = useState(0);
  const modeLeftRef = useRef(modeLeft);
  const modeRightRef = useRef(modeRight);

  const [projects, setProjects] = useState<PointcloudProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [openSide, setOpenSide] = useState<"left" | "right" | null>(null);
  const syncRafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setProjectsLoading(true);
        setProjectsError(null);
        const res = await fetch("/api/pointclouds/list");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { projects: PointcloudProject[] };
        if (cancelled) return;
        setProjects(json.projects ?? []);
      } catch (e) {
        if (cancelled) return;
        setProjectsError(e instanceof Error ? e.message : "Ошибка загрузки списка");
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    modeLeftRef.current = modeLeft;
  }, [modeLeft]);

  useEffect(() => {
    modeRightRef.current = modeRight;
  }, [modeRight]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = window as unknown as {
          Potree?: unknown;
          Copc?: unknown;
        };

        for (const href of POTREE_CSS) await loadCss(href);

        const needCopc = !w.Copc;
        const needPotree = !w.Potree;

        if (needPotree) {
          for (const src of POTREE_SCRIPTS) await loadScript(src);
        } else if (needCopc) {
          await loadScript("/potree/libs/copc/index.js");
        }

        if (cancelled) return;
        setScriptsReady(true);
      } catch (e) {
        setLoadError(
          e instanceof Error
            ? e.message
            : "Не удалось загрузить Potree. Выполните: npm run potree:build",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!scriptsReady || !leftRef.current || !rightRef.current) return;

    const Potree = (window as unknown as { Potree: Record<string, unknown> })
      .Potree as unknown as {
      Viewer: new (el: HTMLElement) => ViewerInstance;
      loadPointCloud: (
        url: string,
        name: string,
        cb: (e: { pointcloud: Parameters<typeof applyVisual>[0] }) => void,
      ) => void;
      PointSizeType: { ADAPTIVE: number };
      PointShape: { SQUARE: number };
    };

    const elL = leftRef.current;
    const elR = rightRef.current;

    const vL = new Potree.Viewer(elL);
    const vR = new Potree.Viewer(elR);
    leftViewerRef.current = vL;
    rightViewerRef.current = vR;

    vL.setEDLEnabled(true);
    vR.setEDLEnabled(true);
    vL.setFOV(60);
    vR.setFOV(60);
    vL.setPointBudget(2_000_000);
    vR.setPointBudget(2_000_000);
    vL.setBackground("gradient");
    vR.setBackground("gradient");

    let leftPc: Parameters<typeof applyVisual>[0] | null = null;
    let rightPc: Parameters<typeof applyVisual>[0] | null = null;

    const tryFit = () => {
      if (!leftPc || !rightPc) return;
      vL.fitToScreen();
      vR.fitToScreen();
      copyView(
        vL.scene.view as Parameters<typeof copyView>[0],
        vR.scene.view as Parameters<typeof copyView>[1],
      );
    };

    const applyControls = () => {
      vL.controls.enabled = true;
      vR.controls.enabled = true;
    };
    applyControls();

    let prevLeft = viewSnapshot(
      vL.scene.view as unknown as { position: { x: number; y: number; z: number }; yaw: number; pitch: number; radius: number },
    );
    let prevRight = viewSnapshot(
      vR.scene.view as unknown as { position: { x: number; y: number; z: number }; yaw: number; pitch: number; radius: number },
    );

    const syncLoop = () => {
      const leftView = vL.scene.view as Parameters<typeof copyView>[0] & {
        position: { x: number; y: number; z: number };
      };
      const rightView = vR.scene.view as Parameters<typeof copyView>[0] & {
        position: { x: number; y: number; z: number };
      };
      const currentLeft = viewSnapshot(leftView);
      const currentRight = viewSnapshot(rightView);

      if (lockedRef.current) {
        if (lastTouchedRef.current === "left") {
          copyView(leftView, rightView as Parameters<typeof copyView>[1]);
        } else {
          copyView(rightView, leftView as Parameters<typeof copyView>[1]);
        }
      }
      prevLeft = viewSnapshot(leftView);
      prevRight = viewSnapshot(rightView);
      syncRafRef.current = window.requestAnimationFrame(syncLoop);
    };
    syncRafRef.current = window.requestAnimationFrame(syncLoop);

    const markLeftTouched = () => {
      lastTouchedRef.current = "left";
    };
    const markRightTouched = () => {
      lastTouchedRef.current = "right";
    };
    elL.addEventListener("pointerdown", markLeftTouched, { passive: true });
    elR.addEventListener("pointerdown", markRightTouched, { passive: true });
    elL.addEventListener("wheel", markLeftTouched, { passive: true });
    elR.addEventListener("wheel", markRightTouched, { passive: true });
    elL.addEventListener("touchstart", markLeftTouched, { passive: true });
    elR.addEventListener("touchstart", markRightTouched, { passive: true });

    Potree.loadPointCloud(urlLeft, "A", (e) => {
      leftPc = e.pointcloud;
      vL.scene.addPointCloud(e.pointcloud);
      applyVisual(e.pointcloud, modeLeftRef.current, Potree);
      tryFit();
    });
    Potree.loadPointCloud(urlRight, "B", (e) => {
      rightPc = e.pointcloud;
      vR.scene.addPointCloud(e.pointcloud);
      applyVisual(e.pointcloud, modeRightRef.current, Potree);
      tryFit();
    });

    return () => {
      if (syncRafRef.current != null) {
        window.cancelAnimationFrame(syncRafRef.current);
        syncRafRef.current = null;
      }
      elL.removeEventListener("pointerdown", markLeftTouched);
      elR.removeEventListener("pointerdown", markRightTouched);
      elL.removeEventListener("wheel", markLeftTouched);
      elR.removeEventListener("wheel", markRightTouched);
      elL.removeEventListener("touchstart", markLeftTouched);
      elR.removeEventListener("touchstart", markRightTouched);
      vL.renderer.setAnimationLoop(null);
      vR.renderer.setAnimationLoop(null);
      leftViewerRef.current = null;
      rightViewerRef.current = null;
      elL.innerHTML = "";
      elR.innerHTML = "";
    };
  }, [scriptsReady, urlLeft, urlRight, loadKey]);

  useEffect(() => {
    const vL = leftViewerRef.current;
    const vR = rightViewerRef.current;
    if (!vL || !vR) return;
    vL.controls.enabled = true;
    vR.controls.enabled = true;
  }, [locked, scriptsReady, loadKey]);

  useEffect(() => {
    const Potree = (window as unknown as { Potree: { PointSizeType: { ADAPTIVE: number }; PointShape: { SQUARE: number } } })
      .Potree;
    if (!Potree) return;
    const vL = leftViewerRef.current;
    const vR = rightViewerRef.current;
    if (!vL || !vR) return;
    const pl = vL.scene.pointclouds as Parameters<typeof applyVisual>[0][];
    const pr = vR.scene.pointclouds as Parameters<typeof applyVisual>[0][];
    for (const pc of pl) applyVisual(pc, modeLeft, Potree);
    for (const pc of pr) applyVisual(pc, modeRight, Potree);
  }, [modeLeft, modeRight, scriptsReady, loadKey]);

  const toggleLock = useCallback(() => {
    setLocked((prev) => {
      const next = !prev;
      if (next) {
        const vL = leftViewerRef.current;
        const vR = rightViewerRef.current;
        if (vL && vR) {
          if (lastTouchedRef.current === "right") {
            copyView(
              vR.scene.view as Parameters<typeof copyView>[0],
              vL.scene.view as Parameters<typeof copyView>[1],
            );
          } else {
            copyView(
              vL.scene.view as Parameters<typeof copyView>[0],
              vR.scene.view as Parameters<typeof copyView>[1],
            );
          }
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      setSplit(Math.min(1, Math.max(0, x)));
    };
    const onUp = () => {
      dragging.current = false;
      const vL = leftViewerRef.current;
      const vR = rightViewerRef.current;
      if (vL) vL.controls.enabled = true;
      if (vR) vR.controls.enabled = true;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const reload = useCallback(() => {
    setLoadKey((k) => k + 1);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.toolbar}>
        <h1 className={styles.title}>3D Viewer</h1>
        <button type="button" className={styles.btn} onClick={toggleLock}>
          {locked ? "Разблокировать камеры" : "Синхронизировать камеры"}
        </button>
        <span className={styles.hint}>
          Режим: {locked ? "синхронный" : "независимый"}
        </span>
      </header>

      <div className={styles.controls}>
        <div className={styles.row}>
          <label>
            Левый cloud.js / URL
            <input
              className={styles.input}
              value={urlLeft}
              onChange={(e) => setUrlLeft(e.target.value)}
            />
          </label>
          <div className={styles.sideBtns}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setOpenSide("left")}
              disabled={projectsLoading}
            >
              Открыть (левый)
            </button>
          </div>
          <label>
            Режим
            <select
              value={modeLeft}
              onChange={(e) => setModeLeft(e.target.value as VisualMode)}
            >
              <option value="elevation">Высота (elevation)</option>
              <option value="rgba">RGB</option>
              <option value="intensity">Интенсивность</option>
            </select>
          </label>
        </div>
        <div className={styles.row}>
          <label>
            Правый cloud.js / URL
            <input
              className={styles.input}
              value={urlRight}
              onChange={(e) => setUrlRight(e.target.value)}
            />
          </label>
          <div className={styles.sideBtns}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setOpenSide("right")}
              disabled={projectsLoading}
            >
              Открыть (правый)
            </button>
          </div>
          <label>
            Режим
            <select
              value={modeRight}
              onChange={(e) => setModeRight(e.target.value as VisualMode)}
            >
              <option value="elevation">Высота (elevation)</option>
              <option value="rgba">RGB</option>
              <option value="intensity">Интенсивность</option>
            </select>
          </label>
        </div>
        <button type="button" className={styles.btn} onClick={reload}>
          Перезагрузить облака
        </button>
      </div>

      {loadError && (
        <div className={styles.error}>
          {loadError}
          <br />
          <code className={styles.code}>npm run potree:build</code>
        </div>
      )}

      {openSide && (
        <div
          className={styles.modalOverlay}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpenSide(null);
          }}
        >
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                Выбор проекта для {openSide === "left" ? "левого" : "правого"} вида
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setOpenSide(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            {projectsLoading ? (
              <div className={styles.modalBody}>Загрузка списка...</div>
            ) : projectsError ? (
              <div className={styles.modalBody}>{projectsError}</div>
            ) : (
              <div className={styles.modalBody}>
                {projects.length === 0 ? (
                  <div>В `assets/pointclouds` проектов не найдено.</div>
                ) : (
                  <div className={styles.projectList}>
                    {projects.map((p) => {
                      const url = p.defaultUrl;
                      const isSelected =
                        openSide === "left" ? urlLeft === url : urlRight === url;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={styles.projectItem}
                          data-selected={isSelected ? "true" : "false"}
                          onClick={() => {
                            if (!url) return;
                            if (openSide === "left") setUrlLeft(url);
                            else setUrlRight(url);
                            setOpenSide(null);
                          }}
                          disabled={!url}
                          title={!url ? "В этой папке нет cloud.js или ept.json" : undefined}
                        >
                          <div className={styles.projectName}>{p.name}</div>
                          <div className={styles.projectMeta}>
                            {p.cloudJsUrl ? "cloud.js" : ""}
                            {p.cloudJsUrl && p.eptJsonUrl ? " + " : ""}
                            {p.eptJsonUrl ? "ept.json" : ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={wrapRef} className={styles.wrap}>
        <div
          className={styles.panel}
          style={{ clipPath: `inset(0 ${((1 - split) * 100).toFixed(4)}% 0 0)` }}
        >
          <div className={styles.label}>Левый</div>
          <div
            ref={leftRef}
            className={styles.potreeArea}
          />
        </div>
        <div
          className={styles.divider}
          style={{ left: `calc(${(split * 100).toFixed(4)}% - 5px)` }}
          onMouseDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            const vL = leftViewerRef.current;
            const vR = rightViewerRef.current;
            if (vL) vL.controls.enabled = false;
            if (vR) vR.controls.enabled = false;
          }}
          title="Перетащить"
        />
        <div
          className={styles.panel}
          style={{ clipPath: `inset(0 0 0 ${(split * 100).toFixed(4)}%)` }}
        >
          <div className={styles.label}>Правый</div>
          <div
            ref={rightRef}
            className={styles.potreeArea}
          />
        </div>
      </div>
    </div>
  );
}
