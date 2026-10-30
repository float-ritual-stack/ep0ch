import { outlinesDir } from "./discover";
import { openLinked } from "@ep0ch/outliner/link";
import { DEFAULT_WEB_ORIGIN, WEB_ROOT, webBase } from "@ep0ch/outliner/artifact-grants";
import { servingSession } from "./session/session-term";
import type { Ctx } from "./app";
import { qualifiedReference, referencedBlock } from "@ep0ch/outline-core/link-syntax";
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

/** The one place that decides whether an outside open belongs on this machine. */
export function opensRemotely(): boolean {
  const client = servingSession()?.typingOn();
  return (client ? client.hello.remote : !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY))
    || (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);
}

export async function openRemote(url: string, ctx: Ctx): Promise<boolean> {
  const session = servingSession(), client = session?.typingOn();
  const write = session && client ? (bytes: string) => session.write(bytes, client) : undefined;
  const result = await openLinked(outlinesDir(), url, client ? client.hello.remoteAddress : (process.env.SSH_CONNECTION || process.env.SSH_CLIENT)?.split(" ")[0]);
  if (result.opened) {
    ctx.flash(`opened ${url} on ${result.machine}`);
    return true;
  }
  const copied = ctx.copy?.(url, undefined, write);
  ctx.flash(`${result.error ? `${result.error.split(/\r?\n/, 1)[0]} · ` : ""}${copied ? "copied" : "not copied"} ${url} · click to open`, 12000, { href: url, ...(result.error ? { kind: "error" as const, stack: result.error } : {}) });
  return false;
}

/**
 * A note's address on the web client (PIE-1297, `note.copy-ref kind=link`): `target` is its id or Work ID, at
 * `/pub/o/<outline>/p/<target>` on EP0CH_WEB_URL's origin (`webBase`), else `DEFAULT_WEB_ORIGIN`. The outline is always
 * named: the door doesn't know which outline the web client serves at its root, and that one's `/pub/o/<name>/` redirects
 * to `/pub/p/`. With no outline known, `/pub/p/<target>`. `destinationOf` reads it back as a note.
 */
export function notePageUrl(target: string, outline: string | undefined, env: Record<string, string | undefined> = process.env): string {
  const base = webBase(env) ?? `${DEFAULT_WEB_ORIGIN}${WEB_ROOT}`;
  return `${base}${outline ? `/o/${encodeURIComponent(outline)}` : ""}/p/${encodeURIComponent(target)}`;
}

const BLOCK_ID = /^[A-Za-z0-9_-]{8,}$/;
const FRAGMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Where a link's destination goes: `{ web }` for http(s), a door target for a pi-outliner:// block, page or
 * Work-ID link, or `{ refused }` with why (another pi-outliner kind the door can't open yet, or not a link).
 */
export function destinationOf(url: string, env: Record<string, string | undefined> = process.env): { web: string } | { target: LinkTarget } | { refused: string } {
  const u = url.trim();
  if (u.startsWith("ep0ch://")) {
    try { const a = parseEp0chBlockUri(u); return { target: { block: a.blockId, outline: a.outline, machine: a.machine, ...(a.fragment ? { fragment: a.fragment } : {}) } }; }
    catch (e) { return { refused: (e as Error).message }; }
  }
  if (/^https?:\/\//i.test(u)) {
    try {
      const p = new URL(u);
      // What notePageUrl writes, on the web client's origin or the default one: `/pub/o/<outline>/p/<target>`, or `/pub/p/<target>` (this outline's).
      const ours = [DEFAULT_WEB_ORIGIN, webBase(env)].some(b => b && new URL(b).host === p.host);
      const match = ours && p.pathname.match(/^\/pub\/(?:o\/([^/]+)\/(?:p\/)?|p\/)([^/]+)\/?$/);
      if (match) {
        const value = decodeURIComponent(match[2]!);
        return { target: { ...(match[1] ? { outline: decodeURIComponent(match[1]) } : {}), ...(BLOCK_ID.test(value) && /^[0-9a-f-]{36}$/i.test(value) ? { block: value } : { page: value }), ...(p.hash ? { fragment: p.hash.slice(1) } : {}) } };
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
  if (p.hostname === "block" && BLOCK_ID.test(qualifiedReference(value).target) && (!fragment || FRAGMENT_ID.test(fragment))) return { target: { block: value, ...(fragment ? { fragment } : {}) } };
  if (p.hostname === "page" || p.hostname === "work") return { target: { page: value } };
  return { refused: `the door can't open pi-outliner://${p.hostname} links yet` };
}

/**
 * The note a pasted address names (PIE-1398): any form `note.copy-ref` copies, read back by the readers that own
 * them: a block id or a reference written whole (outline-core's `referencedBlock`: `((id|label))`, `((outline:id|…))`,
 * `((id^anchor|…))`), an `ep0ch://` address or a note's web link (`destinationOf`). Anything else (words, an action
 * line, a web page that isn't a note) is none.
 */
export function addressOf(text: string, env: Record<string, string | undefined> = process.env): (LinkTarget & ({ block: string } | { page: string })) | null {
  const t = text.trim();
  if (!t || /\s/.test(t.replace(/\|[^]*$/, ""))) return null;
  const ref = referencedBlock(t);
  if (ref) return { block: ref.blockId, ...(ref.outline ? { outline: ref.outline } : {}), ...(ref.fragment ? { fragment: ref.fragment } : {}), ...(ref.label ? { label: ref.label } : {}) };
  if (!/^(?:ep0ch|https?|pi-outliner):\/\//i.test(t)) return null;
  const to = destinationOf(t, env);
  return "target" in to && (to.target.block || to.target.page) ? to.target as LinkTarget & ({ block: string } | { page: string }) : null;
}

/** Published note links in the service's Resources rows still open as notes in the door. */
export function addressedResource(link: AuthoredResourceLink): LinkTarget | null {
  const r = link.resolution;
  const url = r.kind === "unregistered" && r.reference.kind === "web" ? r.reference.url : r.kind === "ready" && r.provider === "web" ? r.addressLabel : null;
  if (!url) return null;
  const to = destinationOf(url);
  return "target" in to && to.target.outline ? to.target : null;
}
