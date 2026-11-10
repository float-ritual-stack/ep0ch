import { settingsSchemas, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { blockNameOf } from "@ep0ch/outline-core/component-warnings";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { viewWords } from "@ep0ch/outline-core/view-spec";
import { missingPropertyHint } from "@ep0ch/outline-core/property-hint";
import type { QuestionFacet } from "@ep0ch/outline-core/protocol";
import { componentsOf, componentsReady } from "../component-schemas";
import { extensionList } from "../extensions";
import { NODELIST_QUERY, nodesOf } from "../echonet/net";
import { tokensFor, printable } from "../props";
import type { Msg } from "../board";
import { EditConflict, RECORDED_AS, recordedAnswer, type Actor } from "../socket";
import { askInBar, changedQuestionValue } from "../bar/ask";
import { ActionRefused, def } from "./actions";
import { PropertyPanel } from "./props-panel";
import { SettingsCard, settingFields, settingOptions, settingProblem, settingQuestion, settingValue, type SettingField, type SettingSources } from "./settings-card";
import { modeBinding, modeActionKeys } from "./modes";
import { ATTACHED_KEYS, SETTINGS_KEYS } from "./attached-keys";
import { partyOf } from "../steps";
import { SETTINGS_JOURNAL, undoneSaid, UndoHistory } from "../undo-journal";
import { outlineChanged } from "../search-schedule";
import type { Key } from "../term";
import { boundComponent, setBinding, type Binding } from "./binding";
import type { NoteSurface, On, SurfaceHost } from "./note";
import type { ListHandle } from "./list-view";
import type { ExtensionSettings } from "@ep0ch/outline-core/protocol";
import type { ExtensionEntry } from "../extensions";
import { clearOf, configureExtension, extensionCardSchema, extensionCardValues, pageExtension, settingsNow } from "../extension-settings";
import { LineField } from "./line";
import { DraftSession, type DraftTarget } from "../draft-session";
import { USER } from "../socket";

export interface SettingsSubject { note: Msg; binding: Binding; schemas: ComponentSchema[]; fields: SettingField[]; list?: ListHandle; collection?: NonNullable<ListHandle["collection"]>["answer"]; props?: Record<string, unknown>;
  /**
   * An inline figure's fields live in its YAML (PIE-1513: a live ::graph-table's own keys); an inline view's and a note's in
   * `note` properties; an extension's page's (`[ext.page::<id>]`, PIE-1709) in that extension's config.json on the host.
   */
  where: "note" | "yaml" | "extension";
  /** The extension whose settings these are, and what the service says of them now. */
  ext?: { entry: ExtensionEntry; settings: ExtensionSettings } }
/**
 * A settings write for ctrl+z (PIE-1513): the note's text before and after, so one key goes back whole, YAML line and all.
 * An extension's setting (`ext`, PIE-1709) keeps the field's value before and after as it reads (null: left out).
 */
export interface SettingsUndo { block: string; before: string; after: string; key: string; by: string; context: string; ext?: { id: string; before: string | null; after: string | null } }
/** The settings writes made in readers (a view's or a live figure's key), newest last, for ctrl+z (`settings.undo`); each party undoes its own. */
export const SETTINGS_UNDO = new UndoHistory<SettingsUndo>(SETTINGS_JOURNAL, { kind: "settings", via: "settings.undo", label: e => `the settings change to ${e.key}` });
const LIST = { type: "string", optional: true, about: "the view: its list.blocks number or ^name; left out, the card's subject or the view under the cursor" } as const;
const KEY = { type: "string", about: "the field's key (settings lists them)" } as const;
const properties = (config: Record<string, unknown>) => Object.entries(config).map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join(", ") : String(value) }));

/** An extension's page as a settings subject (PIE-1709): its card's fields are its configSchema's, its secrets' and its agents'. */
function extensionSubject(note: Msg): SettingsSubject | null {
  const entry = pageExtension(parsePropertyRecords(note.text).filter(p => p.scope === "block"));
  const settings = entry && settingsNow(entry);
  if (!entry || !settings) return null;
  const schema = extensionCardSchema(entry, settings), values = extensionCardValues(entry, settings);
  const fields = schema.props.map((prop, i): SettingField => {
    const v = values.get(prop.key)!;
    return { n: i + 1, prop, value: v.value, section: 0, ext: v };
  });
  return { note, binding: { block: note.id }, schemas: [schema], fields, where: "extension", ext: { entry, settings } };
}

export function settingsSubject(surface: NoteSurface, note: Msg, named?: string): SettingsSubject {
  if (named === undefined) { const ext = extensionSubject(note); if (ext) return ext; }
  const card = surface.panel?.card;
  const listName = named ?? card?.list;
  const current = surface.listHost().current();
  const lists = surface.listsDrawn.filter(l => l.binding);
  const list = named !== undefined ? surface.listNamed(named) : listName !== undefined ? lists.find(l => l.key === listName) : lists.find(l => l.key === current) ?? (lists.length === 1 ? lists[0] : undefined);
  const binding = list?.binding ?? { block: note.id };
  const inline = binding.component ? boundComponent(note, binding) : null;
  if ((listName !== undefined && !list) || (binding.component && !inline)) return { note, binding, schemas: [], fields: [], where: "note" };
  const collection = list?.collection?.answer;
  // An inline component is configured by its own schema (parts describe themselves): a ::view by the views', a live
  // ::graph-table by the table's, its fields the YAML keys it reads, never the view's keys for its query (PIE-1513).
  const own = inline ? componentsOf(surface.src).filter(s => blockNameOf(s) === inline.block.name) : [];
  const where = inline && inline.block.name !== "view" ? "yaml" : "note";
  const props = where === "yaml" ? properties(inline!.yaml) : collection ? properties(collection.config) : parsePropertyRecords(note.text).filter(p => p.scope === "block");
  const schemas = inline ? own : settingsSchemas(componentsOf(surface.src), props);
  return { note, binding, schemas, fields: settingFields(schemas, props, where), list, collection, props: inline?.props, where };
}

export function openSettings(surface: NoteSurface, subject: SettingsSubject, on?: { machine?: string | undefined; host: string }): SettingsCard {
  if (!subject.schemas.length) throw new ActionRefused("this note isn't configured by a component · i lists its properties; a view's ≡ settings opens its card");
  surface.panel ??= new PropertyPanel();
  surface.panel.full = false;
  const card = new SettingsCard(subject.schemas, subject.list?.key);
  if (surface.panel.card?.id !== card.id || surface.panel.card?.list !== card.list) { card.place = surface.attachments.keptPlace("settings") ?? card.place; surface.panel.card = card; }
  // An extension's card says the machine its config.json is on (PIE-1709): the one the outline's host runs on.
  if (subject.ext && on) surface.panel.card.on = on.machine ?? on.host;
  surface.attachedKeys("settings");
  return surface.panel.card;
}

export function settingsKey(surface: NoteSurface, key: Key, host: SurfaceHost): boolean {
  const card0 = surface.panel!.card!, e = card0.editing;
  if (e) {
    // A setting typed in place (PIE-1709): the line's own keys, as every place a person types has them; ⏎ (or ctrl+s)
    // saves through its session, esc keeps the old value. A write under way holds what's typed until it answers.
    if (e.session.holding(key, held => { e.input.take(held); })) return true;
    if (e.input.take(key)) { e.session.status.say(""); card0.note = ""; host.redraw(); return true; }
    if (e.input.closesBy(key)) { e.session.dispose(); card0.editing = null; card0.note = ""; host.redraw(); return true; }
    const bound = e.input.binding(key)?.action;
    if (key.kind === "enter" || bound === "edit.save") void saveSetting(card0, host);
    host.redraw();
    return true;
  }
  const binding = modeBinding(SETTINGS_KEYS, key), card = surface.panel!.card!;
  const field = surface.settingFields(surface.msg!, card.schemas)[card.sel];
  if (binding) void surface.runKey(binding.action as keyof typeof SETTINGS_DEFS, { ...binding.args, ...(["settings.set", "settings.clear", "settings.try"].includes(binding.action) && field ? { key: field.prop.key } : {}) } as never, host);
  return true;
}

function sources(subject: SettingsSubject, host: SurfaceHost): SettingSources {
  const listed = () => (extensionList()?.extensions ?? []).filter(e => e.state === "active" || e.state === "failed");
  return {
    facets: () => subject.collection?.facets ?? [],
    facet: key => facet(subject, host, key),
    catalog: (key, prefix) => host.ctx.board.request("properties.catalog", { ...(key ? { key } : {}), prefix, limit: 30 }),
    actions: () => listed().flatMap(e => e.actions.filter(a => (a.on ?? "block") === "block" && !a.builtIn).map(a => ({ value: `${e.id}/${a.id}`, label: `${e.id}/${a.id} · ${a.label}`, detail: a.effects }))),
    extensions: () => listed().map(e => e.id),
    nodes: async () => {
      const { notes } = await host.ctx.board.queryNotes(NODELIST_QUERY, 10, "show");
      const whole = await Promise.all(notes.map(n => host.ctx.board.get(n.id)));
      return [...new Set(whole.flatMap(n => n ? nodesOf(n.text).map(e => e.node) : []))];
    },
  };
}

async function read(on: On, list?: string): Promise<SettingsSubject> {
  const { surface } = on;
  if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
  const note = await surface.whole();
  await tokensFor(note.text, surface.src);
  if (surface.src) await componentsReady(surface.src);
  const subject = settingsSubject(surface, note, list);
  if (!subject.schemas.length) throw new ActionRefused("this note isn't configured by a component (settings says which notes are)");
  if (subject.ext) return subject;
  if (subject.list?.collection) {
    subject.collection = await subject.list.collection.read(subject.props ?? { of: `((${note.id}))` });
    // A view's values are the collection's answered config (an `of=` merges a saved view's); a figure's stay its own YAML.
    if (subject.where === "note") subject.fields = settingFields(subject.schemas, properties(subject.collection.config));
  }
  return subject;
}

function fieldOf(subject: SettingsSubject, key: string): SettingField {
  // A key matches whatever its case; the field keeps the schema's own spelling (`titleColumn`) for the write.
  const field = subject.fields.find(f => f.prop.key.toLowerCase() === key.trim().toLowerCase());
  if (!field) throw new ActionRefused(`${subject.schemas.map(s => s.title).join(" + ")} has no field ${key}; its fields are ${subject.fields.map(f => f.prop.key).join(", ")}`);
  return field;
}

async function facet(subject: SettingsSubject, host: SurfaceHost, key: string): Promise<QuestionFacet | undefined> {
  if (!subject.collection) return undefined;
  const answer = await host.ctx.board.request("blocks.query", { query: { ...subject.collection.question, facets: [key], facetValues: 1, limit: 1 }, fields: ["id"] });
  return answer.facets?.find(f => f.key === key && f.count > 0);
}

async function choiceProblem(subject: SettingsSubject, host: SurfaceHost, field: SettingField, value: string): Promise<string | undefined> {
  const p = field.prop;
  if (p.question?.source === "facets") {
    const key = p.question.order ? value.replace(/\s+(asc|desc)$/i, "") : value;
    const keys = settingOptions(field, subject.collection?.facets ?? []).map(o => o.value);
    if (!keys.includes(key) && !await facet(subject, host, key)) return missingPropertyHint(key, keys);
  } else if (p.values && !p.values.some(v => v.value === value)) return `${p.key} is one of ${p.values.map(v => v.value).join(", ")}`;
}

async function write(on: On, subject: SettingsSubject, field: SettingField, value: string | null, actor: Actor, checked?: string[]) {
  const { surface, host } = on, { note, binding } = subject;
  let saved: Msg;
  try { saved = await setBinding(host.ctx.board, note, binding, field.prop.key, value, actor); }
  catch (error) {
    if (error instanceof EditConflict) {
      const now = await host.ctx.board.get(note.id);
      if (now && surface.msg?.id === now.id) surface.refresh(now);
      host.redraw();
      throw new ActionRefused("the note changed elsewhere since its settings were read · not saved; re-read it · settings opens the current values");
    }
    throw error;
  }
  SETTINGS_UNDO.push({ block: note.id, before: note.text, after: saved.text, key: field.prop.key, by: partyOf(actor), context: surface.msg?.id ?? note.id });
  subject.note = saved;
  const beforeValues = viewWords(field.value);
  field.value = value;
  if (surface.msg?.id === note.id) surface.refresh({ ...saved, childIds: surface.msg.childIds });
  if (subject.list) for (const state of subject.list.view.settings.values()) delete state[field.prop.key];
  const warnings = checked ?? (field.prop.question?.source === "facets" && value
    ? (await Promise.all(viewWords(value).filter(v => !beforeValues.includes(v)).map(v => choiceProblem(subject, host, field, v)))).filter((p): p is string => p !== undefined) : []);
  const said = `${value === null ? "cleared" : "saved"} · ${field.prop.key}${value === null ? "" : `: ${printable(value)}`}`;
  const message = [said, ...warnings].join(" · ");
  if (surface.panel?.card) surface.panel.card.say(message, warnings.length ? "problem" : "news");
  host.ctx.flash(message);
  surface.noteAgent(actor, said);
  host.redraw();
  return { saved: true, warnings, cleared: value === null, key: field.prop.key, to: value, revision: saved.revision, recordedAs: recordedAnswer(actor) };
}

/** What a typed value is to the extension's field (PIE-1709): true or false, a number, or the words as typed. */
function extGiven(subject: SettingsSubject, key: string, raw: string): Record<string, unknown> {
  const f = subject.ext!.settings.fields.find(x => x.name === key), t = raw.trim();
  if (f?.type === "boolean") { if (t !== "true" && t !== "false") throw new ActionRefused(`${key} is true or false, not ${JSON.stringify(t)}`); return { [key]: t === "true" }; }
  if (f && (f.type === "number" || f.type === "integer") && t) {
    const n = Number(t);
    if (Number.isNaN(n)) throw new ActionRefused(`${key} is a number, not ${JSON.stringify(t)}`);
    return { [key]: n };
  }
  return { [key]: raw };
}

/**
 * An extension's setting written (PIE-1709): through the one write (`configureExtension`: the schema checks it, config.json
 * on the host holds it), kept for ctrl+z, and said on the card and to an agent's watcher.
 */
async function extWrite(on: Pick<On, "surface" | "host">, subject: SettingsSubject, key: string, given: Record<string, unknown>, actor: Actor) {
  const { surface, host } = on, { entry } = subject.ext!;
  const before = subject.fields.find(f => f.prop.key === key)?.value ?? null;
  const r = await configureExtension(host.ctx, entry, settingsNow(entry) ?? subject.ext!.settings, given, actor);
  const after = extensionCardValues(entry, r.settings).get(key)?.value ?? null;
  SETTINGS_UNDO.push({ block: subject.note.id, before: "", after: "", key, by: partyOf(actor), context: surface.msg?.id ?? subject.note.id, ext: { id: entry.id, before, after } });
  const said = `${after === null ? `${key} back to its default` : `saved · ${key}: ${printable(after)}`}${r.error ? ` · but ${r.error.replace(/\s+/g, " ")}` : ""}`;
  if (surface.panel?.card) surface.panel.card.say(said, r.error ? "problem" : "news");
  host.ctx.flash(said);
  surface.noteAgent(actor, said);
  host.redraw();
  return { saved: true, key, to: after, file: r.settings.file, ...(r.error ? { error: r.error } : {}), recordedAs: recordedAnswer(actor) };
}

/** Open the line under `key` for typing in place (PIE-1709): its value now (else its default), in the shared editor, saved by its session. */
function editInPlace(on: Pick<On, "surface" | "host">, subject: SettingsSubject, key: string): { editing: string } {
  const card = on.surface.panel?.card;
  if (!card) throw new ActionRefused(", opens settings first");
  const field = subject.fields.find(f => f.prop.key === key)!, was = field.value ?? field.prop.default ?? "";
  const input = new LineField(was, false, { complete: false });
  input.enterSaves = true;
  const name = subject.ext!.entry.name ?? subject.ext!.entry.id;
  const target: DraftTarget = {
    place: `setting:${subject.ext!.entry.id}:${key}`, back: `⏎ on ${key} brings it back`, label: `${subject.ext!.entry.id}-${key}`,
    what: `${name}'s ${key}`, verb: "save", leaveWrites: false, returns: { what: "setting", does: "saves" },
    async submit(s, by, { report }) {
      const text = s.draft.text;
      // As it was: nothing to write (its default stays its default, never written down as set).
      if (text.trim() === was.trim()) return { ok: true, said: "unchanged" };
      report.phase("saving");
      try { const r = await extWrite(on, subject, key, extGiven(subject, key, text), by); return { ok: true, said: r.to === null ? `${key} back to its default` : `saved · ${key}` }; }
      catch (e) { const why = e instanceof Error ? e.message : String(e); return { ok: false, why, said: why }; }
    },
  };
  card.editing = { key, input, session: DraftSession.open(target, { draft: input.draft, base: 0 }, { redraw: () => on.host.redraw(), said: text => on.host.ctx.flash(text) }) };
  card.note = "";
  on.host.redraw();
  return { editing: key };
}

/** ⏎ on the line being typed: saved through its session; a refusal stays on the card, the line keeps what was typed. */
async function saveSetting(card: NonNullable<NonNullable<NoteSurface["panel"]>["card"]>, host: SurfaceHost) {
  const e = card.editing;
  if (!e || e.session.busy) return;
  const r = await e.session.submit(host.actor ?? USER).finally(() => host.redraw());
  if (!r.ok) { card.say(r.why ?? "not saved", "problem"); host.redraw(); return; }
  if (card.editing === e) card.editing = null;
  if (r.said === "unchanged") card.say(`${e.key} unchanged`);
  host.redraw();
}

/** An extension's settings as an agent reads them (PIE-1709): each field's label, value, state, what it does and its try. */
const describeExt = (subject: SettingsSubject) => ({
  extension: subject.ext!.entry.id, file: subject.ext!.settings.file, state: subject.ext!.settings.state, ...(subject.ext!.settings.error ? { error: subject.ext!.settings.error } : {}),
  fields: subject.fields.map(f => ({ key: f.prop.key, value: f.value, state: f.ext!.state, meaning: f.prop.meaning, ...(f.prop.default !== undefined ? { default: f.prop.default } : {}),
    ...(f.prop.values ? { choices: f.prop.values.map(v => v.value) } : {}), ...(f.ext!.tries ? { tries: f.ext!.tries } : {}) })),
});
const describe = (subject: SettingsSubject) => subject.ext ? describeExt(subject) : ({ id: subject.note.id, revision: subject.note.revision, schema: subject.schemas[0]!.id, schemas: subject.schemas.map(s => ({ id: s.id, title: s.title })), title: subject.schemas.map(s => s.title).join(" + "),
  ...(subject.list ? { list: subject.list.key } : {}), fields: subject.fields.map(f => ({ key: f.prop.key, section: subject.schemas[f.section]!.id, type: f.prop.type, question: f.prop.question?.type, value: f.value, meaning: f.prop.meaning,
    ...(f.prop.default !== undefined ? { default: f.prop.default } : {}), ...(f.prop.values ? { choices: f.prop.values.map(v => v.value) } : f.prop.samples ? { samples: f.prop.samples } : {}) })) });

export const SETTINGS_DEFS = {
  // The property panel's row pick (PIE-1293): tab, j and k step its rows, as the panel's hint row names them.
  "props.pick": def({
    summary: "step the property panel's lit row", keys: "tab, j, k, ↑ ↓ in the property panel", touches: "nothing", replay: "safe", person: "the panel's lit row is the person's",
    args: { by: { type: "number", about: "rows to step, negative up" } },
    examples: [{ act: "props.pick by=1", does: "lights the panel's next property" }],
    run({ by }, { surface, host }: On) {
      const P = surface.panel, m = surface.msg;
      if (!P || !m) throw new ActionRefused("i opens the property panel first");
      const count = surface.rows(m).length;
      if (count) { P.sel = (P.sel + by + count) % count; P.note = ""; }
      host.redraw(); return { selected: P.sel + 1 };
    },
  }),
  "settings.pick": def({
    summary: "pick a field in the attached settings card", keys: modeActionKeys(ATTACHED_KEYS, "settings.pick"), touches: "nothing", replay: "safe", person: "the field selection is the person's",
    args: { n: { type: "number", optional: true, about: "field from one" }, by: { type: "number", optional: true, about: "step through fields" } },
    examples: [{ act: "settings.pick n=2", does: "lights the card's second field" }, { act: "settings.pick by=1", does: "steps to the next field" }],
    run({ n, by }, { surface, host }: On) {
      const card = surface.panel?.card;
      if (!card) throw new ActionRefused(", opens settings first");
      const count = surface.settingFields(surface.msg!, card.schemas).length;
      card.sel = n === undefined ? (card.sel + (by ?? 0) + count) % count : Math.max(0, Math.min(count - 1, n - 1));
      card.note = ""; host.redraw(); return { selected: card.sel + 1 };
    },
  }),
  "settings.focus": def({
    summary: "give the settings card or its reader the keys", keys: "click", touches: "nothing", replay: "safe", person: "the keys belong to the person",
    args: { on: { type: "boolean", about: "whether settings takes the keys" } },
    examples: [{ act: "settings.focus on=true", does: "gives the settings card the keys" }],
    run({ on }, { surface, host }: On) { const mode = surface.modes.get("panel"); if (mode) surface.modes.focus(mode, on); if (on) { surface.attachedKeys("settings"); host.enterMode?.(); } host.redraw(); return { focused: on }; },
  }),
  "settings.place": def({
    summary: "place settings through the reader's attached surface", keys: modeActionKeys(ATTACHED_KEYS, "settings.place"), touches: "tile", replay: "safe", person: "the placement belongs to the person",
    args: { place: { type: "string", optional: true, about: "inline, floating, split, popup or tile; omitted opens the placement menu" }, side: { type: "string", optional: true, about: "left, right, up or down for its tile" } },
    examples: [{ act: "settings.place place=floating", does: "floats the settings card over the reader" }, { act: "settings.place place=tile side=right", does: "puts it in a tile to the reader's right" }],
    async run({ place, side }, { surface, host }: On) {
      if (!surface.panel?.card) throw new ActionRefused(", opens settings first");
      if (place === undefined && side === undefined) return surface.openPlacementMenu("settings", host);
      return { place: await surface.attachments.put("settings", place, host, side) };
    },
  }),
  "settings.move": def({
    summary: "move or resize the floating settings card", keys: "drag its header or corner; ctrl+g then arrows or shift+arrows, h j k l or H J K L; 0 its usual place", touches: "tile", replay: "safe", person: "the placement belongs to the person",
    args: { ...Object.fromEntries(["row", "col", "rows", "cols", "dx", "dy", "drows", "dcols"].map(key => [key, { type: "number" as const, optional: true, about: key }])), reset: { type: "boolean", optional: true, about: "the usual position and size" } },
    examples: [{ act: "settings.move dx=4 dy=-2", does: "nudges the floating card four columns right and two rows up" }, { act: "settings.move reset=true", does: "puts it back at its usual place and size" }],
    run: (args, { surface, host }: On) => surface.attachments.move("settings", args, host),
  }),
  "settings.grip": def({
    summary: "move or resize settings with the attached surface's grip keys", keys: modeActionKeys(ATTACHED_KEYS, "settings.grip"), touches: "tile", replay: "ask", person: "the placement belongs to the person", args: {},
    async run(_, { surface, host }: On) { const card = surface.panel?.card; if (!card) throw new ActionRefused(", opens settings first"); if (card.place !== "floating" && card.place !== "tile") await surface.attachments.put("settings", "floating", host); surface.modes.push(surface.gripMode(card, "settings")); host.redraw(); return { moving: true }; },
  }),
  settings: def({
    summary: "open the settings card over a note or an inline view, with fields from its component schema. An agent reads the fields without moving the person's keys",
    keys: ", or a view's ≡ settings", touches: "nothing", replay: "safe",
    menu: { label: "settings", group: "Note", key: ",", now: ({ surface }: On) => !surface.msg || surface.msg.partial || !surface.settingsSchemaOf(surface.msg) ? { hide: true } : null },
    args: { list: LIST },
    examples: [{ act: "settings", does: "opens the settings card over the note or the view under the cursor; an agent reads its fields", safe: true }, { act: "settings list=1", does: "opens the first view's settings" }],
    async run({ list }, on: On) {
      if (on.surface.panel?.field) throw new ActionRefused("a property value is being typed here · enter saves it, esc cancels, then , opens settings");
      const subject = await read(on, list);
      if (on.standing) { openSettings(on.surface, subject, on.host.ctx); on.host.enterMode?.(); }
      on.host.redraw();
      return describe(subject);
    },
  }),
  "settings.set": def({
    summary: "set a settings field in its own source; without value=, ask its schema's question in the power bar",
    keys: "enter or e on a field; click the selected field", touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { list: LIST, key: KEY, value: { type: "string", optional: true, about: "new value; left out asks the person" } },
    examples: [{ act: "settings.set key=sort value=due", does: "writes sort: due into the view's own source" }, { act: "settings.set key=layout", does: "asks the person for a layout in the power bar" }],
    async run({ list, key, value }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      if (subject.ext) {
        // An extension's setting (PIE-1709): written to its config.json; the person's ⏎ types it in place, or picks a choice.
        if (value !== undefined) return extWrite(on, subject, field.prop.key, extGiven(subject, field.prop.key, value), actor);
        if (actor.kind !== "user") throw new ActionRefused(`say value=…: ${field.prop.key} · ${field.prop.meaning}`);
        if (!field.prop.values) return editInPlace(on, subject, field.prop.key);
        const q = settingQuestion(field, sources(subject, on.host));
        return askInBar(on.host.ctx as never, `${subject.schemas[0]!.title} · ${field.prop.key}`, [q], {}, actor, answers => extWrite(on, subject, field.prop.key, extGiven(subject, field.prop.key, answers[field.prop.key] ?? ""), actor));
      }
      const set = async (answer: string, checked?: string[]) => {
        const to = settingValue(field, answer), why = to ? settingProblem(field, to) : null;
        if (why) throw new ActionRefused(why);
        if (to === field.value) {
          if ((await on.host.ctx.board.get(subject.note.id))?.revision !== subject.note.revision) throw new ActionRefused("the note changed elsewhere since its settings were read · not saved; open them again (settings)");
          return { saved: false, unchanged: true, key: field.prop.key, revision: subject.note.revision };
        }
        return write(on, subject, field, to || null, actor, checked);
      };
      if (value !== undefined) return set(value);
      if (actor.kind !== "user") throw new ActionRefused(`say value=…: ${field.prop.key} is ${field.prop.type}: ${field.prop.meaning}`);
      const question = settingQuestion(field, sources(subject, on.host));
      if (field.prop.question) question.change = async next => {
        const before = viewWords(field.value ?? field.prop.default);
        for (const v of viewWords(next)) if (!before.includes(v)) { const why = await choiceProblem(subject, on.host, field, v); if (why) throw new ActionRefused(why); }
        return set(next, []);
      };
      return askInBar(on.host.ctx as never, `${subject.schemas[field.section]!.title} · ${field.prop.key}`, [question], {}, actor, answers => set(answers[field.prop.key] ?? ""));
    },
  }),
  "settings.toggle": def({
    summary: "toggle a schema choice or a matched row's property in a settings list, writing the block's source immediately",
    keys: "space or enter on a toggle question's row", touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { list: LIST, key: KEY, value: { type: "string", about: "the choice to show or hide" } },
    examples: [{ act: "settings.toggle key=columns value=due", does: "shows the due column, or hides it when shown" }],
    async run({ list, key, value }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      if (!field.prop.question) throw new ActionRefused(`${key} isn't a toggle or pick-order question · settings.set key=${key} value=… sets it`);
      if (!viewWords(field.value ?? field.prop.default).includes(value)) { const why = await choiceProblem(subject, on.host, field, value); if (why) throw new ActionRefused(why); }
      const next = changedQuestionValue(field.prop.question.type, field.value ?? field.prop.default ?? "", value);
      return write(on, subject, field, next || null, actor, []);
    },
  }),
  "binding.set": def({
    summary: "write one settings binding at the read revision; the note's property or inline view's source is the only store",
    keys: "", touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { list: LIST, key: KEY, value: { type: "string", about: "the value to write" }, revision: { type: "number", about: "the revision settings read" } },
    examples: [{ act: "binding.set key=sort value=due revision=12", does: "writes sort: due at revision 12, refused when the note moved on" }],
    async run({ list, key, value, revision }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      subject.note = { ...subject.note, revision };
      return write(on, subject, field, value, actor);
    },
  }),
  "settings.undo": def({
    summary: "undo the last settings write made in this reader while reading this note (an agent undoes its own, the person theirs): the key's line goes back as it was; refused if the note changed again since",
    keys: "ctrl+z (when a settings write was the last change made here)",
    touches: "draft", draft: "write", replay: "ask", args: {}, answer: RECORDED_AS,
    examples: [{ act: "settings.undo", does: "puts layout back as it was before the last settings write" }],
    async run(_, { surface, host }: On, actor) {
      const e = surface.msg ? SETTINGS_UNDO.last(partyOf(actor), surface.msg.id) : null;
      if (!e) { const why = "no settings change to undo in this note"; host.ctx.flash(why); throw new ActionRefused(why); }
      if (e.ext) {
        // An extension's setting (PIE-1709): put back as it was, unless it changed again since.
        const subject = surface.msg ? settingsSubject(surface, surface.msg) : null;
        const field = subject?.fields.find(f => f.prop.key === e.key);
        if (!subject?.ext || !field || field.value !== e.ext.after) { SETTINGS_UNDO.drop(e); const why = `couldn't undo: ${e.key} changed again since`; host.ctx.flash(why); throw new ActionRefused(why); }
        SETTINGS_UNDO.drop(e);
        const back = e.ext.before === null ? clearOf(e.key) : extGiven(subject, e.key, e.ext.before);
        const r = await configureExtension(host.ctx, subject.ext.entry, subject.ext.settings, back, actor);
        const said = undoneSaid(e);
        host.ctx.flash(said); surface.noteAgent(actor, said);
        if (surface.panel?.card) surface.panel.card.note = said;
        host.redraw();
        return { key: e.key, to: e.ext.before, file: r.settings.file, recordedAs: recordedAnswer(actor) };
      }
      const board = host.ctx.board, now = await board.get(e.block);
      if (!now || now.text !== e.after || now.revision === undefined) { SETTINGS_UNDO.drop(e); const why = `couldn't undo: ${e.key} changed again since`; host.ctx.flash(why); throw new ActionRefused(why); }
      let saved: Msg;
      try { saved = await board.update(now.id, e.before, now.revision, actor); }
      catch (err) { outlineChanged([now.id]); const why = `couldn't undo: ${err instanceof Error ? err.message : String(err)}`; host.ctx.flash(why); host.redraw(); throw new ActionRefused(why); }
      SETTINGS_UNDO.drop(e);
      outlineChanged([now.id]);
      if (surface.msg?.id === now.id) surface.refresh({ ...saved, childIds: surface.msg.childIds });
      const said = undoneSaid(e);
      host.ctx.flash(said); surface.noteAgent(actor, said);
      if (surface.panel?.card) surface.panel.card.note = said;
      host.redraw();
      return { block: now.id, key: e.key, revision: saved.revision ?? null, recordedAs: recordedAnswer(actor) };
    },
  }),
  "settings.try": def({
    summary: "try an extension's setting: run the extension's own try for it (yo's answer model on a short ask) and say what came back, or why not in the command's own words. The extension declares which settings it can try (an action that takes setting=)",
    keys: "t or a click on [try] in the settings card", touches: "nothing", replay: "ask", args: { list: LIST, key: KEY },
    examples: [{ act: "settings.try key=answer", does: "runs yo's answer model once and says its answer, or why not" }],
    async run({ list, key }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      const tries = field.ext?.tries;
      if (!tries) throw new ActionRefused(`${subject.schemas[0]!.title} has no try for ${field.prop.key}${subject.fields.some(f => f.ext?.tries) ? ` · it tries ${subject.fields.filter(f => f.ext?.tries).map(f => f.prop.key).join(", ")}` : ""}`);
      const card = on.surface.panel?.card;
      if (card) { card.trying = field.prop.key; card.note = ""; }
      on.host.redraw();
      try {
        const r = await on.host.ctx.dispatch!.act({ action: tries, args: { setting: field.prop.key } }, actor) as { message?: string; ok?: boolean } | undefined;
        const said = r?.message ?? "tried: nothing said";
        if (card) card.say(said, said.startsWith("✗") ? "problem" : "news");
        return { tried: field.prop.key, said, ok: !said.startsWith("✗") };
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        if (card) card.say(`✗ ${why}`, "problem");
        throw new ActionRefused(why);
      } finally {
        if (card) card.trying = null;
        on.host.redraw();
      }
    },
  }),
  "settings.reset": def({
    summary: "put every one of an extension's settings back to its default at once (its config.json keeps its secrets' references); ctrl+z puts back the last one changed",
    keys: "X or a click on [↺ all] in an extension's settings card", touches: "nothing", replay: "ask", args: { list: LIST }, answer: RECORDED_AS,
    examples: [{ act: "settings.reset tile=card", does: "takes yo's answer, act, memory and its deadline back to their defaults" }],
    async run({ list }, on: On, actor) {
      const subject = await read(on, list);
      if (!subject.ext) throw new ActionRefused("settings.reset is an extension's (its page's settings card) · x clears one field of a note's");
      const set = subject.ext.settings.fields.filter(f => f.state === "set").map(f => f.name);
      if (!set.length) throw new ActionRefused(`${subject.schemas[0]!.title}'s settings are all their defaults already`);
      return extWrite(on, subject, set[0]!, { unset: set.join(",") }, actor);
    },
  }),
  "settings.clear": def({
    summary: "clear a settings field from its source, so the schema's default holds", keys: "x or delete on a field",
    touches: "draft", draft: "write", replay: "ask", args: { list: LIST, key: KEY }, answer: RECORDED_AS,
    examples: [{ act: "settings.clear key=sort", does: "removes sort from the source, so the schema's default holds" }],
    async run({ list, key }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      if (subject.ext) return extWrite(on, subject, field.prop.key, clearOf(field.prop.key), actor);
      const owner = !subject.binding.component && subject.schemas.find(s => s.source.note?.name === key || s.source.note?.requires?.includes(key));
      if (owner) throw new ActionRefused(`${key} is what makes this note a ${owner.title.toLowerCase().replace(/s$/, "")}: clearing it would undo that · e edits the note`);
      return write(on, subject, field, null, actor);
    },
  }),
};
