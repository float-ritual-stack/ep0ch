// The property panel's actions (props, props.copy/follow/edit/close/summary; the panel's settings rows are
// ./settings.ts's SETTINGS_DEFS, spread in beside them) and decor.raw.
import { EditConflict, RECORDED_AS, recordedAnswer } from "../../socket";
import { checkValue, describeRow, type PropRow } from "../props-panel";
import { noteRow, type On, ROW_ARGS, REFUSED } from "./shared";
import { printable, setUserSummaryKeys, summaryKeys, tokensFor } from "../../props";
import { type ActionDef, ActionRefused, def, keyCaption } from "../actions";
import { type Msg, subject } from "../../board";
import { READER_KEYS, readerKeys } from "../reader-keys";
import { decorationsOf } from "../../projection";
import type { NoteSurface } from "../note";

export const PROPS_DEFS = {
  "props": def({
    summary: "open the property panel: every property token (repeats and block/line/inline scope kept), with the summary line's keys", keys: [{ keys: "i", does: "open the property panel" }, { keys: "I", does: "full", says: "open the property panel filling the reader" }, { keys: "click", does: "on the byline's i N properties, or the BBS reader's" }],
    touches: "nothing", replay: "safe",
    menu: noteRow("properties", "i", { busy: true }),
    args: { full: { type: "boolean", optional: true, about: "fill the reader instead of sitting above the note" } },
    examples: [
      { act: "props", does: "lists every property of the note; the person's panel opens above it" },
      { act: "props full=true", does: "lists every property of the note; the person's panel fills the reader" },
    ],
    async run({ full }, { surface, host, standing }, _actor) {
      if (surface.draft || surface.session) throw new ActionRefused(REFUSED.busy);
      // The panel holds the reader's keys: an agent reads the rows in its reply and leaves the panel be.
      if (standing) { surface.requireNote(); surface.openPanel(!!full); host.redraw(); }
      const m = await surface.whole();
      const t = await tokensFor(m.text, surface.src);
      host.redraw();
      return { id: m.id, revision: m.revision, summary: surface.summary(m), scopes: t.state === "ready" ? "service" : "block only", rows: surface.rows(m, t.state === "ready" ? t.tokens : null).map(r => describeRow(r, surface.src, m.text)) };
    },
  }),
  "props.copy": def({
    summary: "a property's value, returned (the person's own y copies it to their clipboard; an agent's never does)", keys: "i, tab, y",
    touches: "nothing", replay: "safe",
    args: ROW_ARGS,
    examples: [
      { act: "props.copy key=sun", does: "returns the sun property's value; the person's clipboard gets it too" },
      { act: "props.copy n=2", does: "returns the second property's value, as props lists them" },
    ],
    async run({ n, key }, { surface, host }, actor) {
      // The person's y in their open panel copies the row they're on, as drawn now (no wait).
      const now = surface.msg;
      const { row } = actor.kind === "user" && surface.panel && now && !now.partial && n !== undefined ? { row: surface.row(now, n) } : await propRow(surface, n, key);
      // The clipboard and the panel are the person's: an agent gets the value here, and nothing moves.
      if (actor.kind === "user") {
        surface.openPanel(surface.panel?.full);
        surface.panel!.sel = row.n - 1;
        surface.copyValue(row, host);
      }
      host.redraw();
      return { key: row.key, value: row.value };
    },
  }),
  "props.follow": def({
    summary: "open what a block, page or Work-ID value names, or a plain value's own page, that day's note for a date, a project's pull request (a soft link: PIE-408); where it opens is the view's call. An agent's is refused on the reader the person has", keys: "i, tab, o",
    touches: "tile", replay: "ask", way: "following it there would move what they're reading · an agent follows it in another reader (tile=), or opens the note with open id=",
    args: ROW_ARGS,
    examples: [
      { act: "props.follow key=seed-list", does: "opens the note the seed-list property's value names" },
      { act: "props.follow n=3", does: "opens what the third property's value names, as props lists them" },
    ],
    async run({ n, key }, { surface, host }, actor) {
      const { row } = await propRow(surface, n, key);
      if (!row.target) throw new ActionRefused(`${row.key} holds plain text (${row.value}); there is nothing to follow`);
      const m = await surface.followValue(row, host);
      // A soft link with nothing there yet was offered, or a chooser is open: nothing's wrong (PIE-408).
      if (!m && "soft" in row.target) return { opened: null };
      if (!m) throw new ActionRefused(surface.panel?.note || `nothing answers at ${row.value}`);
      surface.noteAgent(actor, `followed ${row.key} to ${subject(m)}`);
      return { opened: m.id, title: subject(m) };
    },
  }),
  "props.edit": def({
    summary: "replace one property value: a properties.patch of that token, refused if the note changed since it was read", keys: [{ keys: "i tab", does: "to the properties" }, { keys: "enter e", does: "edit the value, then typing" }, { keys: "enter", does: "save" }],
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {
      ...ROW_ARGS,
      value: { type: "string", about: "the new value (one line, no ])" },
      revision: { type: "number", optional: true, about: "the revision you read the properties at; refused if the note is past it" },
    },
    examples: [
      { act: "props.edit key=status value=planted", does: "sets the note's status property to planted, as an attributed edit" },
      { act: "props.edit n=2 value=2026-03-14 revision=7", does: "sets the second property, refused if the note is past revision 7" },
    ],
    async run({ n, key, value, revision }, { surface, host }, actor) {
      if (surface.draft || surface.session) throw new ActionRefused(REFUSED.busy);
      const f = surface.panel?.field;
      if (f && (f.session.busy || f.input.text !== f.row.value)) throw new ActionRefused(f.session.busy ? "a value is being saved here" : `a value (${f.row.key}) is being typed here; it's someone else's until saved or cancelled`);
      const { m, row } = await propRow(surface, n, key);
      if (revision !== undefined && m.revision !== revision) throw new ActionRefused(`the note is at revision ${m.revision}, not ${revision}; read the properties again (props)`);
      if (m.revision === undefined) throw new ActionRefused("the note's revision is unknown, so a value edit couldn't be checked");
      // The ordinal belongs to the text it was read from: if the reader moved on meanwhile, don't guess.
      const now = surface.msg;
      if (!now || now.id !== m.id || now.revision !== m.revision || now.text !== m.text)
        throw new ActionRefused(`the note changed while its properties were read (now revision ${now?.id === m.id ? now.revision : "?"}); read them again (props)`);
      const why = checkValue(row, value);
      if (why) throw new ActionRefused(why);
      const to = value.trim();
      if (to === row.value) return { saved: false, unchanged: true, key: row.key, revision: m.revision };
      // Straight to the service at the revision the ordinal came from; the person's panel and keys are left alone.
      let saved: Msg;
      try { saved = await surface.patchValue(m, m.revision, row, to, host.ctx.board, actor); } catch (e) {
        throw new ActionRefused(e instanceof EditConflict ? "the note changed elsewhere since its properties were read · not saved; read them again (props)" : `not saved: ${e instanceof Error ? e.message : String(e)}`);
      }
      host.ctx.flash(`saved · revision ${saved.revision} · ${row.key}: ${printable(row.value)} → ${printable(to)}`);
      surface.noteAgent(actor, `set ${row.key} to ${to}`);
      host.redraw();
      return { saved: true, key: row.key, from: row.value, to, revision: saved.revision ?? null, fromRevision: m.revision, recordedAs: recordedAnswer(actor) };
    },
  }),
  "props.close": def({
    summary: "close the property panel, or its settings card (a value being typed must be saved or cancelled first)", keys: "esc, i, q; in the settings card esc, q or ,",
    touches: "tile", while: "typing", replay: "safe", way: "the property panel they're in is theirs to close",
    args: {},
    run(_, { surface, host }) {
      if (!surface.panel) return { closed: false };
      if (!surface.closePanel()) throw new ActionRefused("a property value is being typed; enter saves it, esc cancels");
      host.redraw();
      return { closed: true };
    },
  }),
  "props.summary": def({
    summary: "choose the summary line's keys (yours, on this machine); a view's [summary-properties::] still decides for its notes", keys: "i, tab, s",
    touches: "screen", replay: "safe",
    args: {
      keys: { type: "string", optional: true, about: "comma-separated keys in order; empty shows no summary" },
      toggle: { type: "string", optional: true, about: "show or hide one key" },
      reset: { type: "boolean", optional: true, about: "forget your choice (back to OUTLINER_PROPERTY_SUMMARY_KEYS or the default)" },
    },
    examples: [
      { act: "props.summary keys=status,due", does: "shows status and due in the summary line, in that order" },
      { act: "props.summary toggle=owner", does: "shows the owner key in the summary line, or hides it if it is shown" },
    ],
    run({ keys, toggle, reset }, { surface, host }) {
      // Each choice counts only when it chooses something (PIE-1681): an empty keys= shows no summary, but reset=false or an empty toggle= picks nothing.
      const given = { keys: keys !== undefined, toggle: !!toggle?.trim(), reset: reset === true };
      if (Object.values(given).filter(Boolean).length !== 1 || (toggle !== undefined && !given.toggle) || (reset !== undefined && !given.reset)) throw new ActionRefused("pass one of keys=a,b toggle=key reset=true");
      if (given.toggle) surface.toggleSummary(toggle!.trim(), host);
      else { setUserSummaryKeys(given.reset ? null : keys!.split(",").map(k => k.trim().toLowerCase()).filter(Boolean)); host.redraw(); }
      const m = surface.msg;
      return { yours: summaryKeys(null), here: m ? surface.summary(m) : null };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const DECOR_DEFS = {
  "decor.raw": def({
    summary: "the note as written, without what the outline's rules draw on it (PIE-600: a heading's band, a meeting's card, a shouted line), or (on=false, or ~ again) with it. The reader's own state: the note is never written",
    keys: readerKeys("decor.raw"),
    touches: "tile", replay: "safe", way: "peek's decorations say what is drawn; open the note in a reader of your own to see it raw",
    args: { on: { type: "boolean", optional: true, about: "true: raw; false: decorated; absent: the other one" } },
    examples: [
      { act: "decor.raw on=true", does: "shows the note as written, without what the rules draw on it" },
      { act: "decor.raw", does: "switches between the note as written and the decorated note" },
    ],
    run({ on }, { surface, host }) {
      const m = surface.requireNote();
      surface.raw = on ?? !surface.raw;
      host.ctx.flash(`${surface.raw ? "raw: the note as written" : "decorated: what the rules draw"} · ${keyCaption(READER_KEYS.find(r => r.action === "decor.raw")!.key)} ${surface.raw ? "draws the rules' decorations again" : "shows the note as written"}`);
      host.redraw();
      return { raw: surface.raw, decorations: surface.raw ? 0 : decorationsOf(m, surface.src).length };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

/**
 * The note's property rows as the service reads its current text (waiting for that answer), and the one
 * `n` or `key` names. A repeated key needs `n`.
 */
async function propRow(surface: NoteSurface, n: number | undefined, key: string | undefined): Promise<{ m: Msg; rows: PropRow[]; row: PropRow }> {
  const m = await surface.whole();
  const t = await tokensFor(m.text, surface.src);
  const rows = surface.rows(m, t.state === "ready" ? t.tokens : null);
  if (n !== undefined) return { m, rows, row: surface.row(m, n, rows) };
  if (!key) throw new ActionRefused("say which property: n (from props) or key");
  const hits = rows.filter(r => r.key === key.toLowerCase());
  if (!hits.length) throw new ActionRefused(`the note has no ${key} property; it has ${[...new Set(rows.map(r => r.key))].join(", ") || "none"}`);
  if (hits.length > 1) throw new ActionRefused(`the note has ${hits.length} ${key} values (${hits.map(r => `n=${r.n} ${r.value}`).join(", ")}); pass n`);
  return { m, rows, row: hits[0]! };
}
