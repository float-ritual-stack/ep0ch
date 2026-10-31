import type { ViewSpec } from "@ep0ch/outline-core/view-spec";
import type { SiteProduced } from "@ep0ch/outline-core/site";
import { actionLine } from "@ep0ch/outline-core/action-line";
import { figureFrame, frame, type FiguresEnv } from "./graphs";
import { liveSource, siteProduced, siteRequest, type LiveSite } from "./live";
import { watchedOn } from "./watched";
import type { LinkBlocksEnv } from "./links";
import { listOpenTarget, type LinkTarget } from "./refs";
import { ListView, PERSON, listRowsOf } from "./surface/list-view";
import { LISTVIEW_ACTIONS } from "./surface/list-actions";
import { keysText } from "./surface/actions";
import { tabStrip } from "./surface/chip-rows";
import { BOLD, C, fg, RESET } from "./style";
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
  view.set(listRowsOf(answer.view));
  for (const [who, state] of view.settings) if (who !== PERSON) {
    const read = siteProduced(note, { kind: "view", props: spec.props, state }, site);
    const value = read && "value" in read ? read.value : undefined;
    if (value?.kind === "view") view.setAnswer(who, listRowsOf(value.view), value.view);
  }
  const press = (action: string, args: Record<string, string>, text: string) => tag?.({ role: "control", label: text, press: { act: actionLine({ action, args: { list: key, ...args } }), block: note ?? "", line: 0 } }, text) ?? text;
  const row = (r: typeof view.rows[number], text: string) => {
    const to = listOpenTarget(r);
    if (!to) return text;
    to.figure = figure;
    return blocks?.row ? blocks.row(key, r.id, to, text, r.group) : tag?.(to, text) ?? text;
  };
  const drawing = view.draw({ primitive: answer.view, cols: Math.max(8, width - 4), focused: entered, selection: true, tag: row,
    link: (id, text, revision) => tag?.({ block: id, role: "row", revision, figure }, text) ?? text,
    header: (by, text) => press("list.sort", { by }, text),
    lane: (lane, text) => press("list.layout", { lane }, text),
    pageControl: (by, text) => press("list.page", { by: String(by) }, text),
  });
  const pages = view.pageCount(PERSON);
  blocks?.seen?.({ binding: note ? { block: note, ...(component ? { component } : {}) } : undefined, n, key, title: answer.title, view, entered, about: answer.question.where,
    collection: { answer, async read(props) {
      const board = (site?.board ?? liveSource().board)!;
      const { produced } = await board.request<{ produced: typeof answer }>("site.answer", siteRequest(note, { kind: "view", props }, site));
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
  const tabs = tabStrip(answer.layouts.map(layout => ({ label: layout === answer.layout ? `[${layout}]` : layout, on: layout === answer.layout })), {
    width: Math.max(8, width - 4), overflow: "wrap", style: { on: BOLD, off: "", sep: " · " },
    tag: (text, i) => press("list.layout", { layout: answer.layouts[i]! }, text),
  }).map(row => row.text);
  const footer = `${answer.view.rows.length} notes${read?.state === "loading" ? " · updating…" : ""}${answer.truncated ? " · more matches" : ""} · ${keysText(LISTVIEW_ACTIONS.def("list.layout")!.keys)}`;
  const controls = [press("list.sort", {}, "sort"), press("list.group", {}, "group"), press("settings", { list: key }, "≡ settings")].join(" · ");
  const warning = answer.error ?? (answer.view.rows.length ? answer.hint : undefined);
  const body = [...tabs, controls, ...(warning ? rowLines(warning, Math.max(8, width - 4)).map(line => fg(C.lred) + line + RESET) : []), ...drawing.lines];
  const control = blocks?.control?.(key, entered ? "esc out" : "⏎ in");
  return sizing ? sizing.finish(body, footer, control) : frame(answer.title, body, width, footer, control);
}
