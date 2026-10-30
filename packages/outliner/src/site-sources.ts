// `site.sources` (PIE-956, S6b): every generated region of a note with what it read, when, what shaped it and what it
// answered, from the one set of readers the page itself is drawn from: the extension registry's handler lines
// (`extensions.outputs`), `template.use`, the figure/fields/if producers (`site.answer`'s `produce`) and the output
// regions' text grammar. The door's Sources inspector draws this answer and the published page's panel, so a second client agrees with it.
// A page shows none of it by default; "where this comes from" asks. Reads only.
import { figureProps, figureSource } from "@ep0ch/outline-core/figure-props";
import { componentBlocks } from "@ep0ch/outline-core/component-block";
import type { SiteProduced } from "@ep0ch/outline-core/site";
import { sourceCalls, yamlParams, type SourceEntry, type SourcesAnswer, type SourcesRequest } from "@ep0ch/outline-core/sources";
import { answerSite } from "./site-answer";
import { slotProps } from "./script-runs";
import type { ResourceProjection } from "./resource-projection";
import { templateUse, type TemplateUseStore } from "./template-use";

/** What the extension registry says of the code behind a handler: its script's note and text, else the extension's id. */
export interface TransformOf { kind: "script" | "extension"; label: string; block?: string; text?: string }

export interface SourcesDeps {
  store: TemplateUseStore;
  /** The note's handler lines (`extensions.outputs`), in any order. */
  projections: readonly ResourceProjection[];
  transformOf(extension: string, handler: string): TransformOf;
  clock?: () => number;
  sequenceSource?(blockId: string, button: import("@ep0ch/outline-core/button-call").ButtonCall, text: string): SourceEntry | undefined;
  depend?: (ids: string[]) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A Markdown table's header and rows, when `text` is (or holds) one. */
export function markdownTable(text: string): { columns: string[]; table: string[][] } | null {
  const lines = text.split("\n");
  const at = lines.findIndex((l, i) => /^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""));
  if (at < 0) return null;
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const table: string[][] = [];
  for (let i = at + 2; i < lines.length && /^\s*\|/.test(lines[i]!); i++) table.push(cells(lines[i]!));
  return { columns: cells(lines[at]!), table };
}

const resultOf = (text: string): SourceEntry["result"] => {
  const t = markdownTable(text);
  return t ? { rows: t.table.length, columns: t.columns, table: t.table, text } : { rows: text.trim() ? text.trim().split("\n").length : 0, text };
};

/** A produced list of notes as a table: id and title. */
function blocksResult(blocks: readonly unknown[]): SourceEntry["result"] {
  const table = (blocks as { id?: string; title?: string; text?: string }[]).map(b => [String(b.id ?? ""), String(b.title ?? (b.text ?? "").split("\n")[0] ?? "")]);
  const propertyNames = [...new Set((blocks as { properties: { key: string }[] }[]).flatMap(b => b.properties.map(p => p.key)))];
  return { rows: blocks.length, columns: ["id", "title"], table, text: table.map(r => r.join("\t")).join("\n"), propertyNames };
}

export function readSources(deps: SourcesDeps, request: SourcesRequest): SourcesAnswer {
  const { store } = deps;
  const clock = deps.clock ?? Date.now;
  const read = (input: import("@ep0ch/outline-core/site").SiteAnswerRequest) => {
    const answer = answerSite(store, { ...input, ...(request.hidden ? { hidden: request.hidden } : {}) }, clock);
    deps.depend?.(answer.deps);
    return answer;
  };
  if (!request || typeof request.blockId !== "string" || !request.blockId.trim()) throw new Error("site.sources needs blockId: the note whose generated regions are asked, for example { blockId: \"PIE-12\" }");
  const host = store.resolveBlockRef(request.blockId);
  const text = host.text;
  const lines = text.split("\n");
  const readAt = new Date(clock()).toISOString();
  const out: SourceEntry[] = [];

  // Handler lines and `::=` lines: the extension registry's, with when each ran.
  for (const p of deps.projections) {
    if (!p.extension || (p.kind !== "output" && p.kind !== "component")) continue;
    const line = p.anchor.line;
    const written = lines[line] ?? "";
    const expr = /^\s*::=/.test(written);
    const argument = expr ? written.replace(/^\s*::=\s*/, "") : (/^[^:]*::\s*(.*)$/.exec(written)?.[1] ?? "");
    const params = expr ? [] : Object.entries(slotProps(argument)).flatMap(([key, values]) => values.map(value => ({ key, value })));
    const t = deps.transformOf(p.extension.id, p.extension.handler);
    const markdown = p.output?.markdown ?? "";
    const queried = p.output?.query;
    const questionParams = queried ? Object.entries(queried.question).map(([key, value]) => ({ key, value: typeof value === "string" ? value : JSON.stringify(value) })) : [];
    const queryRows = queried?.blocks ?? [];
    if (queried) deps.depend?.(queryRows.map(row => row.id));
    const visibleRows = request.hidden?.length ? queryRows.filter(row => !request.hidden!.includes(row.id)) : queryRows;
    out.push({
      key: String(line), kind: expr ? "expr" : "handler", name: expr ? "::=" : p.propertyKey, line, endLine: line,
      ...(p.output?.ranAt ? { readAt: p.output.ranAt } : {}), live: p.extension.effects === "read",
      query: queried ? { params: questionParams, text: queried.question.where ?? "", editable: false } : { params, text: written, editable: !expr },
      transform: expr ? { kind: "expression", label: "one-line script", text: argument } : { kind: t.kind, label: t.label, ...(t.block ? { block: t.block } : {}), ...(t.text !== undefined ? { text: t.text } : {}) },
      result: queried ? blocksResult(visibleRows) : resultOf(markdown),
      ...(p.status !== "ready" && p.status !== "stale" ? { problem: p.reason ?? String(p.status) } : queried && visibleRows.length < queryRows.length ? { problem: "some query rows are not shared here" } : {}),
    });
  }

  // The note's own generated lines.
  for (const c of sourceCalls(text)) {
    const base = { key: c.kind === "output" ? `#${c.region?.anchor ?? c.line}` : String(c.line), kind: c.kind, name: c.name, line: c.line, endLine: c.endLine } as const;
    try {
      if (c.kind === "button" && c.button) {
        const source = deps.sequenceSource?.(host.id, c.button, c.text);
        if (source) out.push(source);
      } else if (c.kind === "use") {
        const a = templateUse(store, { block: host.id, line: c.line }, clock);
        deps.depend?.(a.deps);
        if (a.deps.some(id => request.hidden?.includes(id))) throw new Error("hidden here");
        out.push({ ...base, readAt, live: true, query: { params: c.params, text: c.text, editable: true },
          transform: a.template ? { kind: "template", label: a.template.title, block: a.template.id, text: a.template.text } : { kind: "none", label: "no template" },
          result: a.template ? resultOf(read({ blockId: a.template.id, chain: a.chain, props: a.props, interpolate: { text: a.template.text, fences: "template" } }).interpolated?.text ?? a.template.text) : { rows: 0, text: "" }, ...(a.problems[0] ? { problem: a.problems[0].message } : {}) });
      } else if (c.kind === "figure" && c.figure) {
        const block = componentBlocks(lines).find(b => b.start === c.line);
        const src = figureSource(lines.slice(c.line + 1, block?.end ?? c.endLine), host.id, false, block?.attrs);
        const parsed = figureProps(c.figure.kind, src);
        if ("error" in parsed) throw new Error(parsed.error);
        const props = parsed.props;
        const answer = read({ blockId: host.id, produce: { kind: "figure", figure: c.figure.kind, props } });
        const produced = answer.produced as Extract<SiteProduced, { kind: "figure" }> | undefined;
        const question = typeof props.query === "string" ? props.query : typeof props.view === "string" ? `view ${props.view}` : "";
        out.push({ ...base, readAt, live: true, query: { params: [...yamlParams(c.figure.yaml), ...c.params], text: question || c.text, editable: true },
          transform: { kind: "figure", label: `${c.name} figure`, text: c.figure.yaml || lines.slice(c.line, c.endLine + 1).join("\n") },
          result: produced ? blocksResult(produced.blocks) : { rows: 0, text: "" }, ...(produced?.error ? { problem: produced.error } : {}) });
      } else if (c.kind === "fields") {
        const answer = read({ blockId: host.id, produce: { kind: "fields", key: c.of ?? "", ...(c.params.find(p => p.key === "of") ? { of: c.params.find(p => p.key === "of")!.value } : {}) } });
        const produced = answer.produced as Extract<SiteProduced, { kind: "fields" }> | undefined;
        const table = (produced?.rows ?? []).map(r => [r.value, String(r.line + 1)]);
        out.push({ ...base, readAt, live: true, query: { params: c.params, text: c.text, editable: false },
          transform: { kind: "none", label: "reads the key as written" }, result: { rows: produced?.rows.length ?? 0, columns: ["value", "line"], table, text: table.map(r => r.join("\t")).join("\n") },
          ...(produced?.problem ? { problem: produced.problem.message } : {}) });
      } else if (c.kind === "if") {
        const answer = read({ blockId: host.id, produce: { kind: "if", where: c.of ?? "" } });
        const produced = answer.produced as Extract<SiteProduced, { kind: "if" }> | undefined;
        out.push({ ...base, readAt, live: true, query: { params: c.params, text: c.text, editable: false },
          transform: { kind: "none", label: "a query over this note" }, result: { rows: 1, text: produced ? (produced.holds ? "holds: its body is drawn" : "does not hold: its body is not drawn") : "" },
          ...(produced?.problem ? { problem: produced.problem.message } : {}) });
      } else if (c.kind === "output") {
        const r = c.region!;
        out.push({ ...base, live: false, query: { params: [], text: c.text.replace(/^\s*>\s*/, ""), editable: false },
          transform: r.producer ? { kind: "script", label: "its producer", block: r.producer } : { kind: "none", label: "no producer recorded" },
          result: resultOf(r.body), ...(r.edited ? { problem: "edited here: it is yours now, and its producer's next output waits as a proposal" } : {}) });
      }
    } catch (error) {
      out.push({ ...base, live: false, query: { params: c.params, text: c.text, editable: false }, transform: { kind: "none", label: "" }, result: { rows: 0, text: "" }, problem: message(error) });
    }
  }
  for (const source of out) {
    if (source.transform.block) {
      deps.depend?.([source.transform.block]);
      if (request.hidden?.includes(source.transform.block)) {
        source.transform = { kind: "none", label: "not shared" };
        if (source.kind === "output") source.query.text = source.name;
      }
    }
  }
  out.sort((a, b) => a.line - b.line);
  return { blockId: host.id, revision: host.revision, readAt, sources: out };
}
