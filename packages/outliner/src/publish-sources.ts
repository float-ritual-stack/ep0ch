import type { SiteAnswer } from "@ep0ch/outline-core/site";
import { sourceDownload, type SourcesAnswer } from "@ep0ch/outline-core/sources";
import type { LiveHost } from "./publish-live";
import { escapeHtml } from "./publish";

/** Sources follows the page's existing visibility cut, including dependencies discovered while reading. */
export async function pageSources(host: LiveHost, blockId: string, outline: string, text: string): Promise<string> {
  const hidden = new Set<string>();
  let sources: SourcesAnswer | undefined;
  for (let round = 0; round < 4; round++) {
    const answer = await host.request<SiteAnswer>({ action: "site.answer", blockId, sources: true, hidden: [...hidden] });
    const shown = await host.shown(answer.deps);
    const fresh = answer.deps.filter(id => !shown.has(id) && !hidden.has(id));
    if (!fresh.length) { sources = answer.sources; break; }
    fresh.forEach(id => hidden.add(id));
  }
  if (!sources?.sources.length) return "";
  const e = escapeHtml;
  const copy = (label: string, value: string) => `<button type="button" data-source-copy="${e(value)}">Copy ${label}</button>`;
  const offsets: number[] = [];
  let at = 0;
  for (const line of text.split("\n")) { offsets.push(at); at += line.length + 1; }
  const entries = sources.sources.map((s, i) => {
    const download = (format: "csv" | "json") => `<a download="${e(s.name.replace(/[^a-zA-Z0-9_-]/g, "-"))}.${format}" href="data:${format === "csv" ? "text/csv" : "application/json"};charset=utf-8,${encodeURIComponent(sourceDownload(s.result, format))}">${format.toUpperCase()}</a>`;
    const read = s.readAt ? `${s.live ? "live, " : ""}as of ${s.readAt}` : "as written";
    return `<details class="source-entry" id="source-${i}" data-source-offset="${offsets[s.line] ?? 0}"><summary>${e(s.name)} <small>${e(s.readAt ?? "as written")}</small></summary>
${s.problem ? `<p>${e(s.problem)}</p>` : ""}
<details open><summary>Query</summary><dl>${s.query.params.map(p => `<dt>${e(p.key)}</dt><dd>${e(p.value)}</dd>`).join("")}</dl><pre>${e(s.query.text)}</pre>${copy("query", s.query.text)}</details>
<details><summary>Transform</summary><p>${e(s.transform.label)}</p>${s.transform.block ? `<a href="${e(host.href(s.transform.block) ?? "#")}">Jump to its note</a>` : ""}<pre>${e(s.transform.text ?? "")}</pre>${copy("transform", s.transform.text ?? "")}</details>
<details open><summary>Result · ${s.result.rows} rows</summary><pre>${e(s.result.text)}</pre>${copy("result", s.result.text)} · Download ${download("csv")} ${download("json")}
<dl><dt>Outline</dt><dd>${e(outline)} ${copy("outline", outline)}</dd><dt>Read</dt><dd>${e(read)} ${copy("read", read)}</dd><dt>Query</dt><dd>${e(s.query.text)} ${copy("query", s.query.text)}</dd></dl></details></details>`;
  }).join("\n");
  return `<details class="sources-panel"><summary>Updated <time datetime="${e(sources.readAt)}">${e(sources.readAt)}</time> · Sources</summary><aside aria-label="Sources"><a href="">⟳ Refresh all</a><button type="button" data-sources-close>Close</button><h2>Sources</h2>${entries}</aside></details>`;
}

export const SOURCES_STYLE = `
.fig[data-source]{padding:0;border:0;border-radius:0}.fig[data-source]>.fig-foot{display:none}
.sources-panel{font:13px/1.5 ui-monospace,monospace;color:var(--dim);margin:.5rem 0}
.sources-panel>summary{cursor:pointer}.sources-panel aside{position:fixed;right:0;top:0;bottom:0;width:min(32rem,90vw);overflow:auto;background:var(--bg);color:var(--fg);padding:1.5rem;z-index:20;border-left:1px solid var(--rule)}
.sources-panel details{margin:1rem 0}.sources-panel pre{white-space:pre-wrap;overflow-wrap:anywhere}.sources-panel button{color:var(--link);background:none;border:0;cursor:pointer;font:inherit}.sources-panel dd{margin-left:1rem}.source-entry small{color:var(--dim)}
.source-selection{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:21;padding:.5rem 1rem}
`;
