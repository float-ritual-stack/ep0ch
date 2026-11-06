import type { ViewSpec } from "@ep0ch/outline-core/view-spec";
import type { SiteProduced } from "@ep0ch/outline-core/site";
import { actionLine } from "@ep0ch/outline-core/action-line";
import { figureFrame, frame, type FiguresEnv } from "./graphs";
import { liveSource, siteProduced, siteRequest, type LiveSite } from "./live";
import { watchedOn } from "./watched";
import type { LinkBlocksEnv } from "./links";
import { listOpenTarget, type LinkTarget } from "./refs";
import { ListView, PERSON, listRowsOf } from "./surface/list-view";
import { tabStrip, type Tab } from "./surface/chip-rows";
import { BOLD, C, fg, RESET, visible, width as textWidth } from "./style";
import { rowLines } from "./text";

// A changed query has no first answer yet. Keep the list and its input mounted while that answer arrives.
const shown = new WeakMap<ListView, Extract<SiteProduced, { kind: "view" }>>();

export function renderCollection(spec: ViewSpec, note: string | undefined, width: number, blocks?: LinkBlocksEnv, tag?: (to: LinkTarget, text: string) => string, site?: LiveSite, figures?: FiguresEnv, component?: NonNullable<import("./surface/list-view").ListHandle["binding"]>["component"]): string[] {
  site = { ...site, args: { ...site?.args, ...spec.args } };
  const n = ++(blocks ? blocks.drawn ??= { n: 0 } : { n: 0 }).n;
  const key = spec.key ?? `#${n}`, view = blocks?.list?.(key, "view") ?? new ListView(key, false);
  const state = view.settings.get(PERSON) ?? {};
  const read = siteProduced(note, { kind: "view", props: spec.props, state }, site);
  const value = read?.value;
  if (value?.kind === "view") shown.set(view, value);
  const answer = value ?? (read?.state === "loading" ? shown.get(view) : undefined);
  if (spec.error) return frame("Collection", [fg(C.lred) + spec.error + RESET], width);
  if (!answer || answer.kind !== "view") return frame("Collection", [read?.state === "error" ? read.error : "Reading the collection…"], width);
  const sizing = figures && figureFrame("table", { ...spec.props, title: answer.title }, width, figures, note);
  const figure = sizing ? { figure: sizing.key } : undefined;
  width = sizing?.width ?? width;
  const entered = blocks?.entered?.(key) ?? false;
  const current = blocks?.current?.() === key;
  view.set(listRowsOf(answer.view));
  for (const [who, state] of view.settings) if (who !== PERSON) {
    const read = siteProduced(note, { kind: "view", props: spec.props, state }, site);
    const value = read && "value" in read ? read.value : undefined;
    if (value?.kind === "view") view.setAnswer(who, listRowsOf(value.view), value.view);
  }
  const press = (action: string, args: Record<string, string>, text: string) => tag?.({ role: "control", label: text, listRow: { key }, press: { act: actionLine({ action, args: { list: key, ...args } }), block: note ?? "", line: 0 } }, text) ?? text;
  const row = (r: typeof view.rows[number], text: string) => {
    const to = listOpenTarget(r);
    if (!to) return text;
    to.figure = figure;
    return blocks?.row ? blocks.row(key, r.id, to, text, r.group) : tag?.(to, text) ?? text;
  };
  const drawing = view.draw({ primitive: answer.view, cols: Math.max(8, width - 4), focused: entered || current, selection: true, tag: row,
    ...(blocks?.preview && Number(answer.config.body) > 0 ? { body: (row, cols) => {
      const lines = blocks.preview!(row.id, cols, true);
      return lines.slice(Math.max(0, lines.findIndex(line => visible(line).trim()))).slice(0, Number(answer.config.body));
    } } : {}),
    ...(blocks?.image ? { image: blocks.image } : {}),
    link: (id, text, revision) => tag?.({ block: id, role: "row", revision, figure }, text) ?? text,
    header: (by, text) => press("list.sort", { by }, text),
    lane: (lane, text) => press("list.layout", { lane }, text),
    pageControl: (by, text) => press("list.page", { by: String(by) }, text),
  });
  const pages = view.pageCount(PERSON);
  blocks?.seen?.({ binding: note ? { block: note, ...(component ? { component } : {}) } : undefined, n, key, title: answer.title, view, entered, about: answer.question.where,
    collection: { answer, async read(props) {
      const board = (site?.board ?? liveSource().board)!;
      const { produced } = await board.request("site.answer", siteRequest(note, { kind: "view", props }, site));
      if (produced?.kind !== "view") throw new Error("the service drew no view for this component");
      return produced;
    } },
    detail: { layout: answer.layout, layouts: answer.layouts, sort: answer.question.sort, group: answer.question.group, facets: answer.facets, truncated: answer.truncated, page: view.page + 1, pages },
    async change(changes, who) {
      const next = { ...view.settings.get(who), ...changes };
      view.settings.set(who, next);
      const board = site?.board ?? liveSource().board;
      if (!board) return;
      siteProduced(note, { kind: "view", props: spec.props, state: next }, site);
      await watchedOn(board).settled();
      const read = siteProduced(note, { kind: "view", props: spec.props, state: next }, site);
      const result = read && "value" in read ? read.value : undefined;
      if (result?.kind === "view") view.setAnswer(who, listRowsOf(result.view), result.view);
      liveSource().redraw();
      return result;
    },
  });
  const plain = answer.layouts.length === 1 && !answer.question.group?.length && !answer.question.sort;
  const wanted = !plain || entered || current || view.hovered;
  const inner = Math.max(8, width - 4);
  // The current layout cycles on a narrow row; the full tab set stays on a wide one.
  const compact = textWidth(answer.layouts.join(" · ") + " · sort · group · ≡ settings") > inner;
  const layouts = compact ? [answer.layout] : answer.layouts;
  const controls: (Tab & { action: string; args?: Record<string, string> })[] = [
    ...layouts.map(layout => ({ label: layout, on: layout === answer.layout, action: "list.layout", ...(!compact ? { args: { layout } } : {}) })),
    { label: inner < 26 ? "s" : "sort", hint: "sort", action: "list.sort" },
    { label: inner < 26 ? "g" : "group", hint: "group", action: "list.group" },
    { label: compact ? "≡" : "≡ settings", action: "settings" },
  ];
  const tabs = wanted ? tabStrip(controls, {
    width: inner, overflow: "share", style: { on: BOLD, off: "", sep: " · " },
    tag: (text, i) => press(controls[i]!.action, controls[i]!.args ?? {}, text),
  }).map(row => row.text) : [];
  const footer = `${answer.view.rows.length} notes${read?.state === "loading" ? " · updating…" : ""}${answer.truncated ? " · more matches" : ""}`;
  // A key the graph-table doesn't take (PIE-1513): said here as the write said it, never silently ignored.
  const warning = [spec.warning, answer.error ?? (answer.view.rows.length ? answer.hint : undefined)].filter(Boolean).join(" · ") || undefined;
  const body = [...(warning ? rowLines(warning, inner).map(line => fg(C.lred) + line + RESET) : []), ...drawing.lines];
  const count = blocks?.control?.(key, footer) ?? footer;
  // No in/out control (PIE-1501): its rows are elements, and the [ ] position on one of them has the keys.
  // Reveal in the frame's spacer so the note under the pointer stays put.
  return sizing ? sizing.finish(body, count, "", {}, answer.title, tabs[0]) : frame(answer.title, body, width, count, "", tabs[0]);
}
