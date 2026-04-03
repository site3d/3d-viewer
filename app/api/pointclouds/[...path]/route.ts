import fs from "node:fs";
import path from "node:path";

function safeJoin(root: string, parts: string[]) {
  const cleaned: string[] = [];
  for (const p of parts) {
    if (p.includes("..") || p.includes(":") || p.includes("\\") || p.includes("/")) continue;
    if (!p) continue;
    cleaned.push(p);
  }
  const joined = path.join(root, ...cleaned);
  const rel = path.relative(root, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Invalid path");
  return joined;
}

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".bin":
    case ".las":
    case ".laz":
    case ".dat":
    case ".pco":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  req: Request,
  ctx?: { params?: Promise<{ path?: string[] | string }> | { path?: string[] | string } },
) {
  const resolvedParams = ctx?.params ? await ctx.params : undefined;
  let parts = (resolvedParams?.path ?? []) as string[] | string;
  if (typeof parts === "string") parts = [parts];

  if ((parts as string[]).length === 0) {
    const pathname = new URL(req.url).pathname;
    const prefix = "/api/pointclouds/";
    if (pathname.startsWith(prefix)) {
      const rest = pathname.slice(prefix.length);
      parts = rest.split("/").filter(Boolean);
    }
  }

  if ((parts as string[]).length === 0) {
    return new Response("Missing path", { status: 400 });
  }

  const root = path.join(process.cwd(), "assets", "pointclouds");
  let filePath: string;
  try {
    filePath = safeJoin(root, parts as string[]);
  } catch {
    return new Response("Bad path", { status: 400 });
  }

  if (!fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const buf = fs.readFileSync(filePath);

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

