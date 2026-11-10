// An extension's attached surface (Nov 3 review card 16, ledger H): the one `AttachmentDef` every declared
// `<id>.<kind>` is built from. The extension's record declares the kind and the render script that draws it
// (`extensions.list`'s `attachments`, its manifest's `attachments[]`); the host runs that script (`scripts.render`, as a
// render tile's does) with the note beside it as `props.note`; this adapter keeps only whether it is open, which note it
// is beside, what the script last drew and how far it is scrolled. Placement, layering, splits, floats and tiles are the
// layer's (attachments.ts): no placement code here.
import { ActionRefused } from "./actions";
import type { Attachments, AttachmentHost, AttachedState, AttachmentDef, AttachedView } from "./attachments";
import { C, fg, pad, RESET, width } from "../style";
import { printable } from "../text";

const oneLine = (v: unknown) => printable(v, " ").trim();

/** What the adapter asks of the reader it is beside. */
export interface ExtensionAttachmentAt {
  /** The note the reader shows, or null. */
  note(): string | null;
  /** Ask the host to run the extension's render script with these props. */
  render(of: string, props: Record<string, string[]>): Promise<{ markdown: string }>;
  redraw(): void;
}

/** What it keeps while open. */
/** What a served extension's record says of a kind: its noun, and the render script (its own) that draws it. */
export interface DeclaredAttachment { kind: string; noun: string; render: string }
/** The kinds served extensions declare: replaced whole each time the host's list is bound (extensions.ts). */
const declaredKinds = new Map<string, DeclaredAttachment>();
export function declareAttachmentKinds(list: readonly DeclaredAttachment[]) {
  declaredKinds.clear();
  for (const a of list) declaredKinds.set(a.kind, a);
}
export const declaredAttachment = (kind: string): DeclaredAttachment | undefined => declaredKinds.get(kind);
export const declaredAttachmentKinds = (): string[] => [...declaredKinds.keys()];

export interface ExtensionAttachmentState extends AttachedState {
  /** The note it was drawn for: another note shown asks the script again. */
  note: string | null;
  /** What the script last drew, one clean line each; null: not answered yet. */
  rows: string[] | null;
  scroll: number;
  /** Why the script could not draw. */
  problem?: string;
}

export interface ExtensionAttachment extends AttachmentDef<never, AttachedView> {
  open(): ExtensionAttachmentState;
  close(): void;
  scroll(by: number): number;
  state(): ExtensionAttachmentState | null;
}

export function extensionAttachment(kind: string, decl: { noun: string; render: string }, at: ExtensionAttachmentAt): ExtensionAttachment {
  let state: ExtensionAttachmentState | null = null;
  /** Run the script for the note beside it; the answer redraws the reader. A later ask wins. */
  let asked = 0;
  const refresh = (s: ExtensionAttachmentState) => {
    const note = at.note(), mine = ++asked;
    s.note = note; s.rows = null; delete s.problem;
    if (!note) { s.rows = []; return; }
    at.render(decl.render, { note: [note] }).then(r => {
      if (mine !== asked || state !== s) return;
      s.rows = r.markdown.split("\n").map(l => oneLine(l)); s.scroll = 0;
    }, e => {
      if (mine !== asked || state !== s) return;
      s.rows = []; s.problem = oneLine(String((e as Error)?.message ?? e));
    }).finally(() => { if (state === s) at.redraw(); });
  };
  const def: ExtensionAttachment = {
    kind, noun: decl.noun,
    args: { target: kind },
    // Not served any more (uninstalled, stopped): it is gone from the reader, whatever it kept.
    owner: () => (declaredAttachment(kind) ? state : null),
    state: () => state,
    open() {
      state ??= { place: "split", float: null, note: null, rows: null, scroll: 0 };
      refresh(state);
      return state;
    },
    close() { state = null; asked++; },
    scroll(by) {
      if (!state) throw new ActionRefused(def.closed);
      state.scroll = Math.max(0, Math.min(Math.max(0, (state.rows?.length ?? 0) - 1), state.scroll + by));
      at.redraw();
      return state.scroll;
    },
    draw(cols, rows) {
      const s = state;
      if (!s) return null;
      // Another note in the reader: the script draws for that one.
      if (s.note !== at.note() && s.rows) refresh(s);
      const body = s.problem ? [`${fg(C.lred)}${s.problem}${RESET}`] : s.rows === null ? [`${fg(C.dark)}drawing…${RESET}`] : s.rows.slice(s.scroll);
      const lines = Array.from({ length: rows }, (_, i) => pad(body[i] ?? "", cols));
      return { lines };
    },
    holdsKeys: () => false, tileKeys: () => false,
    actions: { place: "attachment.place", move: "attachment.move" },
    closed: `attachment.open target=${kind} first`,
    chip: () => {
      const f = state?.frame;
      return f ? { col: f.col + f.cols - width(`[${state!.place} ▸]`), row: f.row } : null;
    },
  };
  return def;
}

const isExtensionAttachment = (d: unknown): d is ExtensionAttachment => typeof (d as ExtensionAttachment | undefined)?.open === "function";

/** A reader's `adopt` for the layer: the one adapter for any kind a served extension's record declares, made when it is first named. */
export function extensionAttachments<H extends AttachmentHost, V extends AttachedView>(at: ExtensionAttachmentAt): (kind: string) => AttachmentDef<H, V> | null {
  return kind => {
    const declared = declaredAttachment(kind);
    return declared ? extensionAttachment(kind, declared, at) as unknown as AttachmentDef<H, V> : null;
  };
}

/** The layer's def for `target`, which must be an extension's. */
function extensionKind<H extends AttachmentHost, V extends AttachedView>(layer: Attachments<H, V>, target: unknown): ExtensionAttachment {
  const d = layer.def(layer.kind(target));
  if (!isExtensionAttachment(d)) throw new ActionRefused(`${d.kind} is the reader's own: its own actions open it`);
  return d;
}

/** `attachment.open`: the extension's surface beside the note now shown, placed `place` (default beside it). */
export async function openExtensionAttachment<H extends AttachmentHost, V extends AttachedView>(layer: Attachments<H, V>, target: unknown, place: string | undefined, side: string | undefined, host: H) {
  const d = extensionKind(layer, target);
  d.open();
  return { kind: d.kind, place: await layer.put(d.kind, place ?? "split", host, side) };
}
/** `attachment.close`. */
export function closeExtensionAttachment<H extends AttachmentHost, V extends AttachedView>(layer: Attachments<H, V>, target: unknown, host: H) {
  const d = extensionKind(layer, target);
  d.close();
  void layer.close(d.kind, host);
  host.redraw();
  return { kind: d.kind, closed: true };
}
/** `attachment.scroll`. */
export function scrollExtensionAttachment<H extends AttachmentHost, V extends AttachedView>(layer: Attachments<H, V>, target: unknown, by: number) {
  const d = extensionKind(layer, target);
  return { kind: d.kind, scroll: d.scroll(by) };
}
