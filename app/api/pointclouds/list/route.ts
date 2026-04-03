import fs from "node:fs";
import path from "node:path";

type ProjectInfo = {
  id: string;
  name: string;
  defaultUrl: string | null;
  cloudJsUrl: string | null;
  eptJsonUrl: string | null;
};

function safeJoin(root: string, ...parts: string[]) {
  const joined = path.join(root, ...parts);
  const rel = path.relative(root, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid path");
  }
  return joined;
}

export async function GET() {
  const root = safeJoin(process.cwd(), "assets", "pointclouds");

  if (!fs.existsSync(root)) {
    return Response.json({ projects: [] as ProjectInfo[] });
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const projects: ProjectInfo[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const id = e.name;
    const dir = safeJoin(root, id);

    const cloudJsPath = path.join(dir, "cloud.js");
    const eptJsonPath = path.join(dir, "ept.json");

    const cloudJsUrl = fs.existsSync(cloudJsPath)
      ? `/api/pointclouds/${encodeURIComponent(id)}/cloud.js`
      : null;
    const eptJsonUrl = fs.existsSync(eptJsonPath)
      ? `/api/pointclouds/${encodeURIComponent(id)}/ept.json`
      : null;

    const defaultUrl = cloudJsUrl ?? eptJsonUrl;

    projects.push({
      id,
      name: id,
      defaultUrl,
      cloudJsUrl,
      eptJsonUrl,
    });
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return Response.json({ projects });
}

