import type { SiteProduced } from "@ep0ch/outline-core/site";
import type { ViewSpec } from "@ep0ch/outline-core/view-spec";
import { openedRef, activationOf } from "@ep0ch/outline-core/list-row";
import { actionLine } from "@ep0ch/outline-core/action-line";
import { frame } from "./graphs";
import { liveSource, siteProduced, siteRequest, type LiveSite } from "./live";
import type { LinkBlocksEnv } from "./links";
import type { LinkTarget } from "./refs";
import { ListView, PERSON, listRowsOf } from "./surface/list-view";
import { LISTVIEW_ACTIONS } from "./surface/list-actions";
import { keysText } from "./surface/actions";
import { tabStrip } from "./surface/chip-rows";
import { BOLD, C, fg, RESET } from "./style";
import { rowLines } from "./text";

export function renderCollection(spec: ViewSpec, note: string | undefined, width: number, blocks?: LinkBlocksEnv, tag?: (to: LinkTarget, text: string) => string, site?: LiveSite): string[] {
  site = { ...site, args: { ...site?.args, ...spec.args } };
  const n = ++(blocks ? blocks.drawn ??= { n: 0 } : { n: 0 }).n;
  const key = spec.key ?? `#${n}`, view = blocks?.list?.(key, "view") ?? new ListView(key, false);
  const state = view.settings.get(PERSON) ?? {};
  const read = siteProduced(note, { kind: "view", props: spec.props, state }, site);
  const answer = read && "value" in read ? read.value : undefined;
  if (spec.error) return frame("Collection", [fg(C.lred) + spec.error + RESET], width);
  if (!answer || answer.kind !== "view") return frame("Collection", [read?.state === "error" ? read.error : "Reading the collection…"], width);
  const entered = blocks?.entered?.(key) ?? false;
  view.set(listRowsOf(answer.view));
  const press = (action: string, args: Record<string, string>, text: string) => tag?.({ role: "control", label: text, press: { act: actionLine({ action, args: { list: key, ...args } }), block: note ?? "", line: 0 } }, text) ?? text;
  const row = (r: typeof view.rows[number], text: string) => {
    const ref = openedRef(r);
    if (!ref) return text;
    const activation = activationOf(r);
    const to: LinkTarget = { block: ref, role: "row", openWhere: activation?.where, revision: activation?.revision, at: activation?.at, atLabel: activation?.atLabel, atSays: activation?.atSays };
    return blocks?.row ? blocks.row(key, r.id, to, text) : tag?.(to, text) ?? text;
  };
  const drawing = view.draw({ primitive: answer.view, cols: Math.max(8, width - 4), focused: entered, selection: true, tag: row,
    link: (id, text, revision) => tag?.({ block: id, role: "row", revision }, text) ?? text,
    header: (by, text) => press("list.sort", { by }, text),
    lane: (lane, text) => press("list.layout", { lane }, text),
  });
  blocks?.seen?.({ n, key, title: answer.title, view, entered, about: answer.question.where,
    detail: { layout: answer.layout, layouts: answer.layouts, sort: answer.question.sort, group: answer.question.group, facets: answer.facets, truncated: answer.truncated, page: view.page + 1, pages: Math.max(1, Math.ceil(answer.view.rows.length / (answer.view.page ?? 200))) },
    async change(changes, who) {
      const next = { ...view.settings.get(who), ...changes };
      view.settings.set(who, next);
      const board = site?.board ?? liveSource().board;
      if (!board) return;
      const result = await board.request<{ produced: SiteProduced }>("site.answer", siteRequest(note, { kind: "view", props: spec.props, state: next }, site));
      if (result.produced.kind === "view") view.setAnswer(who, listRowsOf(result.produced.view));
      liveSource().redraw();
      return result.produced;
    },
  });
  const tabs = tabStrip(answer.layouts.map(layout => ({ label: layout === answer.layout ? `[${layout}]` : layout, on: layout === answer.layout })), {
    width: Math.max(8, width - 4), overflow: "wrap", style: { on: BOLD, off: "", sep: " · " },
    tag: (text, i) => press("list.layout", { layout: answer.layouts[i]! }, text),
  }).map(row => row.text);
  const footer = `${answer.view.rows.length} notes${answer.truncated ? " · more matches" : ""} · ${keysText(LISTVIEW_ACTIONS.def("list.layout")!.keys)}`;
  const controls = [press("list.sort", {}, "sort"), press("list.group", {}, "group"),
    ...(answer.view.rows.length > (answer.view.page ?? 200) ? [press("list.page", { by: "-1" }, "‹"), `${view.page + 1}/${Math.ceil(answer.view.rows.length / answer.view.page!)}`, press("list.page", { by: "1" }, "›")] : [])].join(" · ");
  const warning = answer.error ?? (answer.view.rows.length ? answer.hint : undefined);
  return frame(answer.title, [...tabs, controls, ...(warning ? rowLines(warning, Math.max(8, width - 4)).map(line => fg(C.lred) + line + RESET) : []), ...drawing.lines], width, footer, blocks?.control?.(key, entered ? "esc out" : "⏎ in"));
}
