import { ARTIFACT_SCRIPT_SOURCES } from "./publish-artifacts";
import { artifactReference } from "@ep0ch/outline-core/artifacts";
import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

export function artifactResponse(root: string, request: Request, ancestors: string): Response {
  const headers = {
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'unsafe-inline' ${ARTIFACT_SCRIPT_SOURCES}; style-src 'self' 'unsafe-inline'; img-src * data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors ${ancestors}; object-src 'none'`,
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
  };
  const missing = () => new Response("Not found", { status: 404, headers });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers });
  try {
    const parts = decodeURIComponent(new URL(request.url).pathname).split("/").slice(1);
    const [id, ref, ...rest] = parts;
    if (!id || !ref || parts.some(p => p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return missing();
    const parsed = artifactReference(ref);
    if (!parsed) return missing();
    const { name, version } = parsed;
    if (readFileSync(join(root, "ids", name), "utf8") !== id) return missing();
    const folder = version ? join(root, "snapshots", name, String(version), "files") : join(root, "live", name);
    const relative = rest.filter(Boolean);
    let file = join(folder, ...relative);
    if (lstatSync(file).isDirectory()) {
      if (!new URL(request.url).pathname.endsWith("/")) return new Response(null, { status: 308, headers: { ...headers, Location: new URL(request.url).pathname + "/" } });
      const entries = readdirSync(file);
      // A lone non-HTML file is still a one-file artifact, with its original media type.
      file = join(file, entries.includes("index.html") ? "index.html" : relative.length === 0 && entries.length === 1 ? entries[0]! : "index.html");
    }
    let check = folder;
    for (const part of file.slice(folder.length + 1).split(sep)) { check = join(check, part); if (lstatSync(check).isSymbolicLink()) return missing(); }
    if (lstatSync(folder).isSymbolicLink() || !realpathSync(file).startsWith(realpathSync(folder) + sep) || !lstatSync(file).isFile()) return missing();
    return new Response(request.method === "HEAD" ? null : Bun.file(file), { headers: { ...headers, "Content-Type": Bun.file(file).type || "application/octet-stream" } });
  } catch { return missing(); }
}
