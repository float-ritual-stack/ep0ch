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
import { partyOf, UndoHistory } from "../steps";
import { outlineChanged } from "../search-schedule";
import type { Key } from "../term";
import { boundComponent, setBinding, type Binding } from "./binding";
import type { NoteSurface, On, SurfaceHost } from "./note";
import type { ListHandle } from "./list-view";

export interface SettingsSubject { note: Msg; binding: Binding; schemas: ComponentSchema[]; fields: SettingField[]; list?: ListHandle; collection?: NonNullable<ListHandle["collection"]>["answer"]; props?: Record<string, unknown>;
  /** An inline figure's fields live in its YAML (PIE-1513: a live ::graph-table's own keys); an inline view's and a note's in `note` properties. */
  where: "note" | "yaml" }
/** A settings write for ctrl+z (PIE-1513): the note's text before and after, so one key goes back whole, YAML line and all. */
export interface SettingsUndo { block: string; before: string; after: string; key: string; by: string; context: string }
/** The settings writes made in readers (a view's or a live figure's key), newest last, for ctrl+z (`settings.undo`); each party undoes its own. */
export const SETTINGS_UNDO = new UndoHistory<SettingsUndo>();
const LIST = { type: "string", optional: true, about: "the view: its list.blocks number or ^name; left out, the card's subject or the view under the cursor" } as const;
const KEY = { type: "string", about: "the field's key (settings lists them)" } as const;
const properties = (config: Record<string, unknown>) => Object.entries(config).map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join(", ") : String(value) }));

export function settingsSubject(surface: NoteSurface, note: Msg, named?: string): SettingsSubject {
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

export function openSettings(surface: NoteSurface, subject: SettingsSubject): SettingsCard {
  if (!subject.schemas.length) throw new ActionRefused("this note isn't configured by a component · i lists its properties; a view's ≡ settings opens its card");
  surface.panel ??= new PropertyPanel();
  surface.panel.full = false;
  const card = new SettingsCard(subject.schemas, subject.list?.key);
  if (surface.panel.card?.id !== card.id || surface.panel.card?.list !== card.list) { card.place = surface.attachments.keptPlace("settings") ?? card.place; surface.panel.card = card; }
  surface.attachedKeys("settings");
  return surface.panel.card;
}

export function settingsKey(surface: NoteSurface, key: Key, host: SurfaceHost): boolean {
  const binding = modeBinding(SETTINGS_KEYS, key), card = surface.panel!.card!;
  const field = surface.settingFields(surface.msg!, card.schemas)[card.sel];
  if (binding) void surface.runKey(binding.action as keyof typeof SETTINGS_DEFS, { ...binding.args, ...(["settings.set", "settings.clear"].includes(binding.action) && field ? { key: field.prop.key } : {}) } as never, host);
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

const describe = (subject: SettingsSubject) => ({ id: subject.note.id, revision: subject.note.revision, schema: subject.schemas[0]!.id, schemas: subject.schemas.map(s => ({ id: s.id, title: s.title })), title: subject.schemas.map(s => s.title).join(" + "),
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
      if (on.standing) { openSettings(on.surface, subject); on.host.enterMode?.(); }
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
      const board = host.ctx.board, now = await board.get(e.block);
      if (!now || now.text !== e.after || now.revision === undefined) { SETTINGS_UNDO.drop(e); const why = `couldn't undo: ${e.key} changed again since`; host.ctx.flash(why); throw new ActionRefused(why); }
      let saved: Msg;
      try { saved = await board.update(now.id, e.before, now.revision, actor); }
      catch (err) { outlineChanged([now.id]); const why = `couldn't undo: ${err instanceof Error ? err.message : String(err)}`; host.ctx.flash(why); host.redraw(); throw new ActionRefused(why); }
      SETTINGS_UNDO.drop(e);
      outlineChanged([now.id]);
      if (surface.msg?.id === now.id) surface.refresh({ ...saved, childIds: surface.msg.childIds });
      const said = `undid the settings change: ${e.key}`;
      host.ctx.flash(said); surface.noteAgent(actor, said);
      if (surface.panel?.card) surface.panel.card.note = said;
      host.redraw();
      return { block: now.id, key: e.key, revision: saved.revision ?? null, recordedAs: recordedAnswer(actor) };
    },
  }),
  "settings.clear": def({
    summary: "clear a settings field from its source, so the schema's default holds", keys: "x or delete on a field",
    touches: "draft", draft: "write", replay: "ask", args: { list: LIST, key: KEY }, answer: RECORDED_AS,
    examples: [{ act: "settings.clear key=sort", does: "removes sort from the source, so the schema's default holds" }],
    async run({ list, key }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      const owner = !subject.binding.component && subject.schemas.find(s => s.source.note?.name === key || s.source.note?.requires?.includes(key));
      if (owner) throw new ActionRefused(`${key} is what makes this note a ${owner.title.toLowerCase().replace(/s$/, "")}: clearing it would undo that · e edits the note`);
      return write(on, subject, field, null, actor);
    },
  }),
};
