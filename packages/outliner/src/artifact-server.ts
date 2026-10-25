import { ARTIFACT_SCRIPT_SOURCES } from "./publish-artifacts";
import { artifactReference } from "@ep0ch/outline-core/artifacts";
import { readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { artifactKey, DEFAULT_OUTLINE, parseGrant, type Grant } from "./artifact-grants";
import { OutlinerClient } from "./client";
import type { ShareSession } from "@ep0ch/outline-core/protocol";

/**
 * What the artifact host asks of the world beyond its folder: whether a share is open (the one share store, the outline
 * host's), and where a person signs in (the web client's origin, for the page that opens an artifact once they have).
 */
export interface ArtifactAccess {
  shareOpen?: (outline: string, share: string) => Promise<boolean>;
  /** The web client's address with its base path (`https://my.ep0ch.sh/pub`), or none. */
  web?: string;
}

/** Whether a share is open, asked of the outline host over `socket` (every request, so a revoke holds from the next). */
export function sharesFromSocket(socket: string): NonNullable<ArtifactAccess["shareOpen"]> {
  const clients = new Map<string, OutlinerClient>();
  return async (outline, share) => {
    const name = outline === DEFAULT_OUTLINE ? undefined : outline;
    let client = clients.get(outline);
    if (!client) clients.set(outline, (client = new OutlinerClient(socket, 5_000, name)));
    const { shares } = await client.request<{ shares: ShareSession[] }>({ action: "shares.list" });
    return shares.some(row => row.id === share && !row.snapshot && row.state === "active");
  };
}

const page = (title: string, body: string, status: number, headers: Record<string, string>) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<style>:root{color-scheme:dark}body{font:16px/1.5 ui-sans-serif,system-ui,sans-serif;background:#141413;color:#e8e6df;margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:28rem;padding:1.5rem}a{color:#8ab4f8}</style>` +
  `<main>${body}</main>`, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" } });

/**
 * Who may read this request's artifact (PIE-1266), the one place that decides it: a grant in the path, made by the
 * publisher for the signed-in owner or for a share's page, and for a share still open now. Anything else is turned
 * away with a sign-in prompt before the store is touched, so no answer says whether an artifact exists.
 */
export async function artifactAccess(root: string, request: Request, access: ArtifactAccess, headers: Record<string, string>):
  Promise<{ ok: true; grant: Grant; ref: string; rest: string[] } | { ok: false; response: Response }> {
  let parts: string[];
  try { parts = decodeURIComponent(new URL(request.url).pathname).split("/").slice(1); } catch { parts = []; }
  const refused = (said: string, ref?: string) => {
    const open = ref && artifactReference(ref) && access.web ? `${access.web}/a/${encodeURIComponent(ref)}/` : undefined;
    return { ok: false as const, response: page("Sign in", `<h1>${said}</h1>\n<p>${open ? `<a href="${open.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Sign in to open it</a>, or ask for` : "Sign in to the web client, or ask for"} a share link.</p>`, 401, headers) };
  };
  const parsed = parseGrant(artifactKey(root), parts);
  // A bare `/<id>/<ref>/` (before Oct 25) names its artifact but grants nothing.
  const named = parts.find((part, at) => at > 0 && artifactReference(part)) ;
  if (!parsed) return refused("This artifact is private", named);
  if (parsed === "expired") return refused("This link has run out", parts[2]);
  if (parsed.grant.kind === "share") {
    let open = false;
    try { open = !!access.shareOpen && await access.shareOpen(parsed.grant.outline, parsed.grant.share); } catch {
      return { ok: false, response: page("Try again", "<h1>Not reachable right now</h1>\n<p>Try again in a moment.</p>", 503, headers) };
    }
    if (!open) return { ok: false, response: page("Ended", "<h1>This shared link has ended</h1>\n<p>Ask whoever sent it for a new one.</p>", 410, headers) };
  }
  return { ok: true, ...parsed };
}

export async function artifactResponse(root: string, request: Request, ancestors: string, access: ArtifactAccess = {}): Promise<Response> {
  const headers = {
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'unsafe-inline' ${ARTIFACT_SCRIPT_SOURCES}; style-src 'self' 'unsafe-inline'; img-src * data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https:; frame-ancestors ${ancestors}; object-src 'none'`,
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
  };
  const missing = () => new Response("Not found", { status: 404, headers });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers });
  try {
    const parts = decodeURIComponent(new URL(request.url).pathname).split("/").slice(1);
    const url = new URL(request.url);
    const hostName = url.hostname.endsWith(".ep0ch.sh") && url.hostname !== "artifacts.ep0ch.sh" ? url.hostname.slice(0, -9) : undefined;
    const deploymentsFile = join(root, "deployments.json");
    let published: { name: string; where: string }[] = [];
    try { published = JSON.parse(readFileSync(deploymentsFile, "utf8")); } catch { /* No deployed repos yet. */ }
    // A deployed repo is a site, public by the act of deploying it; every other artifact opens only through a grant.
    const deployed = published.find(row => row.where === "float-2" && row.name === (hostName ?? parts[0]));
    let ref: string, rest: string[];
    if (deployed) [ref, rest] = [deployed.name, hostName ? parts : parts.slice(1)];
    else {
      const allowed = await artifactAccess(root, request, access, headers);
      if (!allowed.ok) return allowed.response;
      [ref, rest] = [allowed.ref, allowed.rest];
    }
    if (!ref || parts.some(p => p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return missing();
    const parsed = artifactReference(ref);
    if (!parsed) return missing();
    const { name, version } = parsed;
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
