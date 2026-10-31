import { settingsSchemas, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { viewWords } from "@ep0ch/outline-core/view-spec";
import { missingPropertyHint } from "@ep0ch/outline-core/property-hint";
import type { QuestionFacet } from "@ep0ch/outline-core/protocol";
import { componentsOf, componentsReady } from "../component-schemas";
import { extensionList } from "../extensions";
import { NODELIST_QUERY, nodesOf } from "../echonet/net";
import { tokensFor, printable } from "../props";
import type { Msg } from "../board";
import { EditConflict, mutationFor, type Actor } from "../socket";
import { askInBar, changedQuestionValue } from "../bar/ask";
import { ActionRefused, def } from "./actions";
import { PropertyPanel } from "./props-panel";
import { SettingsCard, settingFields, settingOptions, settingProblem, settingQuestion, settingValue, type SettingField, type SettingSources } from "./settings-card";
import { boundComponent, setBinding, type Binding } from "./binding";
import type { NoteSurface, On, SurfaceHost } from "./note";
import type { ListHandle } from "./list-view";

export interface SettingsSubject { note: Msg; binding: Binding; schemas: ComponentSchema[]; fields: SettingField[]; list?: ListHandle }
const LIST = { type: "string", optional: true, about: "the view: its list.blocks number or ^name; left out, the card's subject or the view under the cursor" } as const;
const KEY = { type: "string", about: "the field's key (settings lists them)" } as const;

export function settingsSubject(surface: NoteSurface, note: Msg, named?: string): SettingsSubject {
  const card = surface.panel?.card;
  const listName = named ?? card?.list;
  const current = surface.listHost().current();
  const lists = surface.listsDrawn.filter(l => l.binding);
  const list = listName !== undefined ? surface.listNamed(listName) : lists.find(l => l.key === current) ?? (lists.length === 1 ? lists[0] : undefined);
  const binding = list?.binding ?? { block: note.id };
  const inline = binding.component ? boundComponent(note, binding) : null;
  const props = inline ? Object.entries(inline.props).map(([key, value]) => ({ key, value: Array.isArray(value) ? value.join(", ") : String(value) })) : parsePropertyRecords(note.text).filter(p => p.scope === "block");
  const schemas = inline ? componentsOf(surface.src).filter(s => s.id === "view") : settingsSchemas(componentsOf(surface.src), props);
  return { note, binding, schemas, fields: settingFields(schemas, props), list };
}

export function openSettings(surface: NoteSurface, subject: SettingsSubject): SettingsCard {
  if (!subject.schemas.length) throw new ActionRefused("this note isn't configured by a component · i lists its properties; a view's ≡ settings opens its card");
  surface.panel ??= new PropertyPanel();
  surface.panel.full = false;
  const card = new SettingsCard(subject.schemas, subject.list?.key);
  if (surface.panel.card?.id !== card.id || surface.panel.card?.list !== card.list) surface.panel.card = card;
  return surface.panel.card;
}

function sources(subject: SettingsSubject, host: SurfaceHost): SettingSources {
  const listed = () => (extensionList()?.extensions ?? []).filter(e => e.state === "active" || e.state === "failed");
  return {
    facets: () => (subject.list?.detail?.facets ?? []) as QuestionFacet[],
    catalog: (key, prefix) => host.ctx.board.propertyCatalog(key, prefix, 30),
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
  return subject;
}

function fieldOf(subject: SettingsSubject, key: string): SettingField {
  const field = subject.fields.find(f => f.prop.key === key.trim().toLowerCase());
  if (!field) throw new ActionRefused(`${subject.schemas.map(s => s.title).join(" + ")} has no field ${key}; its fields are ${subject.fields.map(f => f.prop.key).join(", ")}`);
  return field;
}

function checkChoice(subject: SettingsSubject, field: SettingField, value: string): void {
  const p = field.prop;
  if (p.question?.source === "facets") {
    const key = p.question.order ? value.replace(/\s+(asc|desc)$/i, "") : value;
    const keys = settingOptions(field, (subject.list?.detail?.facets ?? []) as QuestionFacet[]).map(o => o.value);
    if (!keys.includes(key)) throw new ActionRefused(missingPropertyHint(key, keys));
  } else if (p.values && !p.values.some(v => v.value === value)) throw new ActionRefused(`${p.key} is one of ${p.values.map(v => v.value).join(", ")}`);
}

async function write(on: On, subject: SettingsSubject, field: SettingField, value: string | null, actor: Actor) {
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
  subject.note = saved;
  const beforeValues = viewWords(field.value);
  field.value = value;
  if (surface.msg?.id === note.id) surface.refresh({ ...saved, childIds: surface.msg.childIds });
  if (subject.list) for (const state of subject.list.view.settings.values()) delete state[field.prop.key];
  const known = settingOptions(field, (subject.list?.detail?.facets ?? []) as QuestionFacet[]).map(o => o.value);
  const warnings = field.prop.question?.source === "facets" && value ? viewWords(value).map(v => field.prop.question?.order ? v.replace(/\s+(asc|desc)$/i, "") : v).filter(k => !known.includes(k) && !beforeValues.includes(k)) : [];
  const said = `${value === null ? "cleared" : "saved"} · ${field.prop.key}${value === null ? "" : `: ${printable(value)}`}`;
  const message = [said, ...warnings.map(k => missingPropertyHint(k, known))].join(" · ");
  if (surface.panel?.card) surface.panel.card.note = message;
  host.ctx.flash(message);
  surface.noteAgent(actor, said);
  host.redraw();
  return { saved: true, warnings: warnings.map(k => missingPropertyHint(k, known)), cleared: value === null, key: field.prop.key, to: value, revision: saved.revision, recordedAs: mutationFor(actor) };
}

const describe = (subject: SettingsSubject) => ({ id: subject.note.id, revision: subject.note.revision, schema: subject.schemas[0]!.id, schemas: subject.schemas.map(s => ({ id: s.id, title: s.title })), title: subject.schemas.map(s => s.title).join(" + "),
  ...(subject.list ? { list: subject.list.key } : {}), fields: subject.fields.map(f => ({ key: f.prop.key, section: subject.schemas[f.section]!.id, type: f.prop.type, question: f.prop.question?.type, value: f.value, meaning: f.prop.meaning,
    ...(f.prop.default !== undefined ? { default: f.prop.default } : {}), ...(f.prop.values ? { choices: f.prop.values.map(v => v.value) } : f.prop.samples ? { samples: f.prop.samples } : {}) })) });

export const SETTINGS_DEFS = {
  settings: def({
    summary: "open the settings card over a note or an inline view, with fields from its component schema. An agent reads the fields without moving the person's keys",
    keys: ", or a view's ≡ settings", touches: "nothing", replay: "safe",
    menu: { label: "settings", group: "Note", key: ",", now: ({ surface }: On) => !surface.msg || surface.msg.partial || !surface.settingsSchemaOf(surface.msg) ? { hide: true } : null },
    args: { list: LIST },
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
    keys: "enter or e on a field; click the selected field", touches: "draft", draft: "write", replay: "ask",
    args: { list: LIST, key: KEY, value: { type: "string", optional: true, about: "new value; left out asks the person" } },
    async run({ list, key, value }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      const set = async (answer: string) => {
        const to = settingValue(field, answer), why = to ? settingProblem(field, to) : null;
        if (why) throw new ActionRefused(why);
        if (to === field.value) {
          if ((await on.host.ctx.board.get(subject.note.id))?.revision !== subject.note.revision) throw new ActionRefused("the note changed elsewhere since its settings were read · not saved; open them again (settings)");
          return { saved: false, unchanged: true, key: field.prop.key, revision: subject.note.revision };
        }
        return write(on, subject, field, to || null, actor);
      };
      if (value !== undefined) return set(value);
      if (actor.kind !== "user") throw new ActionRefused(`say value=…: ${field.prop.key} is ${field.prop.type}: ${field.prop.meaning}`);
      const question = settingQuestion(field, sources(subject, on.host));
      if (field.prop.question) question.change = async next => { const before = viewWords(field.value ?? field.prop.default); for (const v of viewWords(next)) if (!before.includes(v)) checkChoice(subject, field, v); return set(next); };
      return askInBar(on.host.ctx as never, `${subject.schemas[field.section]!.title} · ${field.prop.key}`, [question], {}, actor, answers => set(answers[field.prop.key] ?? ""));
    },
  }),
  "settings.toggle": def({
    summary: "toggle a schema choice or a matched row's property in a settings list, writing the block's source immediately",
    keys: "space or enter on a toggle question's row", touches: "draft", draft: "write", replay: "ask",
    args: { list: LIST, key: KEY, value: { type: "string", about: "the choice to show or hide" } },
    async run({ list, key, value }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      if (!field.prop.question) throw new ActionRefused(`${key} isn't a toggle or pick-order question · settings.set key=${key} value=… sets it`);
      if (!viewWords(field.value ?? field.prop.default).includes(value)) checkChoice(subject, field, value);
      const next = changedQuestionValue(field.prop.question.type, field.value ?? field.prop.default ?? "", value);
      return write(on, subject, field, next || null, actor);
    },
  }),
  "binding.set": def({
    summary: "write one settings binding at the read revision; the note's property or inline view's source is the only store",
    keys: "", touches: "draft", draft: "write", replay: "ask",
    args: { list: LIST, key: KEY, value: { type: "string", about: "the value to write" }, revision: { type: "number", about: "the revision settings read" } },
    async run({ list, key, value, revision }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      subject.note = { ...subject.note, revision };
      return write(on, subject, field, value, actor);
    },
  }),
  "settings.clear": def({
    summary: "clear a settings field from its source, so the schema's default holds", keys: "x or delete on a field",
    touches: "draft", draft: "write", replay: "ask", args: { list: LIST, key: KEY },
    async run({ list, key }, on: On, actor) {
      const subject = await read(on, list), field = fieldOf(subject, key);
      const owner = !subject.binding.component && subject.schemas.find(s => s.source.note?.name === key || s.source.note?.requires?.includes(key));
      if (owner) throw new ActionRefused(`${key} is what makes this note a ${owner.title.toLowerCase().replace(/s$/, "")}: clearing it would undo that · e edits the note`);
      return write(on, subject, field, null, actor);
    },
  }),
};
