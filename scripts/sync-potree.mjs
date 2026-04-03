import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const POTREE_SRC = path.join(ROOT, "potree-src");
const PUBLIC_POTREE = path.join(ROOT, "public", "potree");

const BUILD_SRC = path.join(POTREE_SRC, "build");
const LIBS_SRC = path.join(POTREE_SRC, "libs");

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function cpRecursive(from, to) {
  ensureDir(path.dirname(to));
  fs.cpSync(from, to, { recursive: true });
}

const potreeJs = path.join(POTREE_SRC, "build", "potree", "potree.js");
const libsOnly = process.argv.includes("--libs-only");

if (!exists(potreeJs) && !libsOnly) {
  console.warn(
    "[sync-potree] Нет potree-src/build/potree/potree.js — сначала соберите Potree:",
  );
  console.warn("  npm install --prefix potree-src");
  process.exit(1);
}

console.log("[sync-potree] Sync → public/potree");

if (!libsOnly) {
  rmrf(PUBLIC_POTREE);
  ensureDir(PUBLIC_POTREE);
} else {
  ensureDir(PUBLIC_POTREE);
}

if (!exists(BUILD_SRC)) {
  if (!libsOnly) throw new Error(`[sync-potree] Не найдено: ${BUILD_SRC}`);
}
if (!exists(LIBS_SRC)) {
  throw new Error(`[sync-potree] Не найдено: ${LIBS_SRC}`);
}

if (!libsOnly) {
  cpRecursive(BUILD_SRC, path.join(PUBLIC_POTREE, "build"));
}
cpRecursive(LIBS_SRC, path.join(PUBLIC_POTREE, "libs"));

console.log("[sync-potree] Готово.");
