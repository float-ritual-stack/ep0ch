import type { SiteAnswer } from "@ep0ch/outline-core/site";
import { sourceDownload, type SourceEntry, type SourcesAnswer } from "@ep0ch/outline-core/sources";
import type { DrawnComponent, LiveHost } from "./publish-live";
import { escapeHtml } from "./publish";

/**
 * The sources a page shows: the page's existing visibility cut, including dependencies discovered while reading, and
 * only those outside a hidden body (`drawn`, the article's own cuts), so a hidden body's text never reaches the panel
 * or its downloads. The panel and its download route (PIE-1383) both read this, so a download is what the panel drew.
 */
export async function visibleSources(host: LiveHost, blockId: string, drawn: ReadonlyMap<number, DrawnComponent>): Promise<{ readAt: string; sources: SourceEntry[] } | undefined> {
  const hidden = new Set<string>();
  let sources: SourcesAnswer | undefined;
  for (let round = 0; round < 4; round++) {
    const answer = await host.request<SiteAnswer>({ action: "site.answer", blockId, sources: true, hidden: [...hidden] });
    const shown = await host.shown(answer.deps);
    const fresh = answer.deps.filter(id => !shown.has(id) && !hidden.has(id));
    if (!fresh.length) { sources = answer.sources; break; }
    fresh.forEach(id => hidden.add(id));
  }
  if (!sources?.sources.length) return undefined;
  const visible = sources.sources.filter(s => ![...drawn].some(([start, region]) =>
    !region.markdown && s.line > start && s.line < region.end));
  return visible.length ? { readAt: sources.readAt, sources: visible } : undefined;
}

/** A source's download, as the route serves it: its result as CSV or JSON, named after the source. */
export function sourceFile(source: SourceEntry, format: "csv" | "json"): { body: string; type: string; filename: string } {
  return {
    body: sourceDownload(source.result, format),
    type: format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    filename: `${source.name.replace(/[^a-zA-Z0-9_-]/g, "-") || "source"}.${format}`,
  };
}

/**
 * Where a source downloads (`<base>/p/<note>/_sources/<key>/<name>.<format>`): a real URL a phone can open or share. It
 * names the source by its key in the note and its name, never its place in the list, so a source added above it since
 * the page was drawn never answers for it: a source no longer there is a 404.
 */
export const sourceHref = (base: string, blockId: string, source: SourceEntry, format: "csv" | "json") =>
  `${base}/p/${blockId}/_sources/${encodeURIComponent(source.key)}/${encodeURIComponent(sourceFile(source, format).filename)}`;
export const SOURCE_ROUTE = /^\/p\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/_sources\/([^/]{1,200})\/([^/]{1,200})\.(csv|json)$/;

/** The source a download route names, among the page's: by its key, and its name as the file is named. */
export function sourceAt(sources: readonly SourceEntry[], key: string, name: string, format: "csv" | "json"): SourceEntry | undefined {
  return sources.find(s => s.key === key && sourceFile(s, format).filename === `${name}.${format}`);
}

/** The Sources panel: each source's query, transform and result, with copies and downloads (a link to the route). */
export async function pageSources(host: LiveHost, blockId: string, outline: string, text: string, drawn: ReadonlyMap<number, DrawnComponent>, base: string): Promise<string> {
  const sources = await visibleSources(host, blockId, drawn);
  if (!sources) return "";
  const e = escapeHtml;
  const copy = (label: string, value: string) => `<button type="button" data-source-copy="${e(value)}">Copy ${label}</button>`;
  const offsets: number[] = [];
  let at = 0;
  for (const line of text.split("\n")) { offsets.push(at); at += line.length + 1; }
  const entries = sources.sources.map((s, i) => {
    const download = (format: "csv" | "json") => `<a data-source-download href="${e(sourceHref(base, blockId, s, format))}" download="${e(sourceFile(s, format).filename)}">${format.toUpperCase()}</a>`;
    const read = s.readAt ? `${s.live ? "live, " : ""}as of ${s.readAt}` : "as written";
    // The downloads first under the source's name, each a tap target (PIE-1409: on a phone they were 15 px tall,
    // behind three disclosures).
    return `<details class="source-entry" id="source-${i}" data-source-offset="${offsets[s.line] ?? 0}"><summary>${e(s.name)} <small>${e(s.readAt ?? "as written")}</small></summary>
<p class="source-downloads">Download ${download("csv")} ${download("json")}</p>
${s.problem ? `<p>${e(s.problem)}</p>` : ""}
<details open><summary>Query</summary><dl>${s.query.params.map(p => `<dt>${e(p.key)}</dt><dd>${e(p.value)}</dd>`).join("")}</dl><pre>${e(s.query.text)}</pre>${copy("query", s.query.text)}</details>
<details><summary>Transform</summary><p>${e(s.transform.label)}</p>${s.transform.block ? `<a href="${e(host.href(s.transform.block) ?? "#")}">Jump to its note</a>` : ""}<pre>${e(s.transform.text ?? "")}</pre>${copy("transform", s.transform.text ?? "")}</details>
<details open><summary>Result · ${s.result.rows} rows</summary><pre>${e(s.result.text)}</pre>${copy("result", s.result.text)}
<dl><dt>Outline</dt><dd>${e(outline)} ${copy("outline", outline)}</dd><dt>Read</dt><dd>${e(read)} ${copy("read", read)}</dd><dt>Query</dt><dd>${e(s.query.text)} ${copy("query", s.query.text)}</dd></dl></details></details>`;
  }).join("\n");
  return `<details class="sources-panel"><summary>Updated <time datetime="${e(sources.readAt)}">${e(sources.readAt)}</time> · Sources</summary><aside aria-label="Sources"><a href="">⟳ Refresh all</a><button type="button" data-sources-close>Close</button><h2>Sources</h2>${entries}</aside></details>`;
}

export const SOURCES_STYLE = `
.fig[data-source]{padding:0;border:0;border-radius:0}.fig[data-source]>.fig-foot{display:none}
.sources-panel{font:13px/1.5 ui-monospace,monospace;color:var(--dim);margin:.5rem 0}
.sources-panel>summary{cursor:pointer}.sources-panel aside{position:fixed;right:0;top:0;bottom:0;width:min(32rem,90vw);overflow:auto;background:var(--bg);color:var(--fg);padding:1.5rem;z-index:20;border-left:1px solid var(--rule)}
.sources-panel details{margin:1rem 0}.sources-panel pre{white-space:pre-wrap;overflow-wrap:anywhere}.sources-panel button{color:var(--link);background:none;border:0;cursor:pointer;font:inherit}.sources-panel dd{margin-left:1rem}.source-entry small{color:var(--dim)}
.source-downloads a,.sources-panel button{display:inline-flex;align-items:center;min-height:44px}.source-downloads a{min-width:44px;justify-content:center;padding:0 .75rem;margin-right:.5rem;border:1px solid var(--rule);border-radius:4px;text-decoration:none;color:var(--link)}.sources-panel summary{min-height:44px;padding:.6rem 0;box-sizing:border-box}
.source-selection{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:21;padding:.5rem 1rem}
`;
