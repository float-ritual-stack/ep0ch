import type { AuthoredResourceLink } from "./authored";
import { parseEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
// Opening what a Markdown link names, as Detail does (pi-herdr-outliner src/detail-controller.ts
// `link.open`, src/open-external.ts, src/outliner-links.ts): an http(s) address opens in the system's
// browser; a pi-outliner:// link to a block, a page or a Work ID opens in the door like `((…))` and `[[…]]`;
// anything else is refused with the reason.
import type { LinkTarget } from "./refs";

/** The command that opens a web address, per platform (Detail's `externalOpenCommand`). */
export function externalOpenCommand(url: string, platform: NodeJS.Platform = process.platform): string[] {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("External web resources must use HTTP or HTTPS");
  if (platform === "darwin") return ["open", parsed.href];
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler", parsed.href];
  return ["xdg-open", parsed.href];
}

/** The command that opens a local file (a figure from the media cache) in the system's viewer, per platform. */
export function fileOpenCommand(path: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "darwin") return ["open", path];
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler", path];
  return ["xdg-open", path];
}

/** Runs a command detached. Tests swap `run` so nothing is really opened. */
export const external = {
  run(cmd: string[]) { Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref(); },
};

const BLOCK_ID = /^[A-Za-z0-9_-]{8,}$/;
const FRAGMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Where a link's destination goes: `{ web }` for http(s), a door target for a pi-outliner:// block, page or
 * Work-ID link, or `{ refused }` with why (another pi-outliner kind the door can't open yet, or not a link).
 */
export function destinationOf(url: string): { web: string } | { target: LinkTarget } | { refused: string } {
  const u = url.trim();
  if (u.startsWith("ep0ch://")) {
    try { const a = parseEp0chBlockUri(u); return { target: { block: a.blockId, outline: a.outline, machine: a.machine, ...(a.fragment ? { fragment: a.fragment } : {}) } }; }
    catch (e) { return { refused: (e as Error).message }; }
  }
  if (/^https?:\/\//i.test(u)) {
    try {
      const p = new URL(u);
      const match = p.hostname === "my.ep0ch.sh" && p.pathname.match(/^\/pub\/o\/([^/]+)\/(?:p\/)?(.+)$/);
      if (match) {
        const value = decodeURIComponent(match[2]!);
        return { target: { outline: decodeURIComponent(match[1]!), ...(BLOCK_ID.test(value) && /^[0-9a-f-]{36}$/i.test(value) ? { block: value } : { page: value }), ...(p.hash ? { fragment: p.hash.slice(1) } : {}) } };
      }
      return { web: p.href };
    } catch { return { refused: `not a web address: ${u}` }; }
  }
  if (!URL.canParse(u)) return { refused: `not a web or outliner link: ${u}` };
  const p = new URL(u);
  if (p.protocol !== "pi-outliner:" || p.username || p.password || p.port || p.hash) return { refused: `not a web or outliner link: ${u}` };
  let value: string;
  try { value = decodeURIComponent(p.pathname.replace(/^\//, "")); } catch { return { refused: `a pi-outliner link that doesn't decode: ${u}` }; }
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return { refused: `a pi-outliner link without a target: ${u}` };
  const fragment = p.searchParams.get("fragment") ?? undefined;
  if (p.hostname === "block" && BLOCK_ID.test(value) && (!fragment || FRAGMENT_ID.test(fragment))) return { target: { block: value, ...(fragment ? { fragment } : {}) } };
  if (p.hostname === "page" || p.hostname === "work") return { target: { page: value } };
  return { refused: `the door can't open pi-outliner://${p.hostname} links yet` };
}

/** Published note links in the service's Resources rows still open as notes in the door. */
export function addressedResource(link: AuthoredResourceLink): LinkTarget | null {
  const r = link.resolution;
  const url = r.kind === "unregistered" && r.reference.kind === "web" ? r.reference.url : r.kind === "ready" && r.provider === "web" ? r.addressLabel : null;
  if (!url) return null;
  const to = destinationOf(url);
  return "target" in to && to.target.outline ? to.target : null;
}
