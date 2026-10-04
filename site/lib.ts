// What site/check.ts reads pages with and serves them from, apart from the run, so site/site.test.ts can hold it.
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { BUILTIN_CALLOUT_REGISTRY } from "../packages/outline-core/src/callouts";

export const unescapeHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const inside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith(`..`) && !isAbsolute(rel);
};

/**
 * The file under `root` a request path names, or null when it names anything outside it: `..`, encoded or not, or
 * a symlink out (site/node_modules links the workspace's packages).
 */
export function siteFile(root: string, pathname: string): string | null {
  let path: string;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  if (path.includes("\0")) return null;
  const target = resolve(root, "." + (path.startsWith("/") ? path : `/${path}`));
  if (!inside(root, target)) return null;
  try { return inside(realpathSync(root), realpathSync(target)) ? target : null; } catch { return null; }
}

/**
 * The site, served on loopback only, on a free port. `/bare/<page>` is the page with every stylesheet and script
 * taken out: what paints before they arrive. Anything outside `root` is a 404.
 */
export function serveSite(root: string) {
  return Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const bare = path.startsWith("/bare/");
      const target = siteFile(root, bare ? path.slice(5) : path);
      const file = target && Bun.file(target);
      if (!file || !(await file.exists())) return new Response("not found", { status: 404 });
      if (!bare) return new Response(file);
      const text = (await file.text()).replace(/<link[^>]*>/g, "").replace(/<script src[^>]*><\/script>/g, "");
      return new Response(text, { headers: { "content-type": "text/html" } });
    },
  });
}

export interface Sample { kind: string; attrs: string; inner: string }

/**
 * Every example a page marks to run (`data-run="…"`), whatever its classes: the `<div>` or `<pre>` that carries
 * the mark, up to its `</pre>`. A mark on anything else, or with no `</pre>` after it, is a problem, never skipped.
 */
export function samples(html: string): { samples: Sample[]; problems: string[] } {
  const out: Sample[] = [], problems: string[] = [];
  for (const m of html.matchAll(/<(\w+)\b([^>]*\bdata-run="([^"]*)"[^>]*)>/g)) {
    const [open, tag, attrs, kind] = m;
    const from = m.index! + open.length, end = html.indexOf("</pre>", from);
    if (tag !== "div" && tag !== "pre") problems.push(`data-run="${kind}" on a <${tag}>: put it on the example's <div class="code"> or its <pre>`);
    else if (end < 0) problems.push(`data-run="${kind}" with no </pre> after it`);
    else out.push({ kind: kind!, attrs: attrs!, inner: html.slice(from, end) });
  }
  return { samples: out, problems };
}

/** The text a sample's reader copies: the inside of its `<pre>`, tags out, entities back. */
export const sampleText = (s: Sample) => unescapeHtml(s.inner.replace(/^[\s\S]*?<pre[^>]*>/, ""));

/** The text of each `<span class="cls">…</span>`, spans inside it (a highlight) and all. */
export function spanTexts(html: string, cls: string): string[] {
  const out: string[] = [], open = new RegExp(`<span class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?">`, "g");
  for (const m of html.matchAll(open)) {
    const at = m.index!;
    let depth = 0, i = at;
    const tags = /<span\b[^>]*>|<\/span>/g;
    tags.lastIndex = at;
    for (let t = tags.exec(html); t; t = tags.exec(html)) {
      depth += t[0] === "</span>" ? -1 : 1;
      if (depth === 0) { i = t.index; break; }
    }
    if (depth !== 0) throw new Error(`an unclosed <span class="${cls}">`);
    out.push(unescapeHtml(html.slice(at + m[0].length, i)));
  }
  return out;
}

/** A note after a diff: its first `dels` lines (the diff's removed lines) replaced by the `add` lines. */
export const editedText = (add: readonly string[], dels: number, note: string) => [...add, ...note.split("\n").slice(dels)].join("\n");

/** Each site callout (`class="callout" data-tone`, an icon, a type) that isn't drawn as the door's built-in type. */
export function calloutMismatches(html: string): string[] {
  const out: string[] = [];
  const marked = [...html.matchAll(/class="callout"/g)].length;
  const read = [...html.matchAll(/class="callout" data-tone="([^"]*)">\s*<(?:div|summary) class="c-title"><span aria-hidden="true">([^<]*)<\/span>([^<]*)<span class="type">([^<]*)<\/span>/g)];
  if (read.length !== marked) out.push(`${marked} callouts, ${read.length} read (each is class="callout" data-tone="…"> then a c-title of an icon span, its title and a type span)`);
  for (const [, tone, icon, title, name] of read) {
    const type = BUILTIN_CALLOUT_REGISTRY.resolve(name!);
    if (!type) out.push(`"${title!.trim()}": [!${name}] isn't a built-in callout type`);
    else if (type.icon !== icon || type.tone !== tone) out.push(`"${title!.trim()}": [!${name}] is ${type.icon} ${type.tone} in the door, ${icon} ${tone} here`);
  }
  return out;
}
