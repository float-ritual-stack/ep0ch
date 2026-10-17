// `template.stamp` in the door (PIE-533 S4): a template written out as a new note, for editing. The service does it
// (`template.stamp`, packages/outliner's src/template-stamp.ts: which values are filled when, what is not stamped, `for=`
// once per match, `freeze=all`); the door asks the person for what they didn't say, in the power bar (src/bar/ask.ts), and
// opens the new note. An agent names everything (`with=` its props) and nothing opens or moves for the person.
//
//   ep0ch act template.stamp of='[[daily-template]]' as=new parent='[[Daily notes]]' title='{{now.date}}'
//   ep0ch act template.stamp of='type:meeting' with='{"with":"Jay"}' freeze=all
import type { PropsSpec } from "@ep0ch/outline-core/site";
import { subject } from "./board";
import type { Ctx, Screen } from "./app";
import { askInBar, type BarQuestion } from "./bar/ask";
import { ActionRefused, actionSet, def } from "./surface/actions";
import type { Actor } from "./socket";

/** What `template.stamp` runs on: the door, and the screen it's pressed on (the top one). */
export interface TemplateOn { ctx: Ctx; here?: Screen }

/** `with=` as props: names to text. */
function propsOf(raw: string | undefined): Record<string, string> {
  if (raw === undefined) return {};
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new ActionRefused("with= is JSON: the template's props, names to text; for example with='{\"who\":\"Jay\"}'"); }
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.values(v).some(x => typeof x !== "string")) throw new ActionRefused("with= maps names to text; for example with='{\"who\":\"Jay\"}'");
  return v as Record<string, string>;
}

/** The question a prop is asked as, in the picker of its kind (a choice's options, a note found by its words). */
export function propQuestion(name: string, field: PropsSpec[string]): BarQuestion {
  const type = field.kind === "choice" ? "choice" : field.kind === "number" ? "number" : field.kind === "note" ? "note" : "text";
  // A default that is itself a path is for the service to fill; a plain one is lit as the answer now.
  const value = field.default !== undefined && !field.default.includes("{{") ? field.default : undefined;
  return { name, type, label: name, ...(field.choices ? { choices: field.choices } : {}), ...(value !== undefined ? { value } : {}), required: !!field.required, ...(field.kind === "tag" ? { free: true, description: "a #tag" } : {}) };
}

/** The props a person is asked for: a choice, a note, or one the template needs (and gives no default for). */
export const asked = (spec: PropsSpec, given: Record<string, string>): BarQuestion[] =>
  Object.entries(spec).filter(([name, f]) => given[name] === undefined && (f.kind === "choice" || f.kind === "note" || (!!f.required && f.default === undefined))).map(([name, f]) => propQuestion(name, f));

export const TEMPLATE_ACTIONS = actionSet<TemplateOn>()("template", {
  "template.stamp": def({
    summary: "write a template out as a new note, for editing (PIE-533): of= the template ([[page]], ((id)), a Work ID, or type:meeting for the note that says [template-for::meeting]); as=new, the only placement so far (into=((id^anchor)) arrives with place()). Its props are with= (JSON, names to text; the person is asked for a choice, a note or a needed one they didn't give). props.x, self.x and now.x are filled now; this.x, parent.x, a bare key and a reference stay as {{ }} and read where the note lands (freeze=all writes those too, for a scaffold with no braces left). parent= the note it goes under (default: the top of the Inbox); title= the new note's title, which may use the stamp's own values ({{now.date}}); for= a query stamps once per match (each is props.for) and skips a match already stamped from this template. The template's own chips ([type::template], [template-for::…], [form-field::…]) are not stamped; [template-for::x] becomes [type::x] and [from-template::((id))] says where it came from. The service writes it, recorded as whoever asks; the person's opens the first note, an agent's opens nothing and never takes their focus",
    keys: "the power bar (ctrl+k: template.stamp), a click on a ::use's “stamp” offer",
    touches: "nothing", replay: "ask",
    says: out => (out?.stamped?.length ? `· ${out.said}` : out?.said ? `· ${out.said}` : null),
    args: {
      of: { type: "string", optional: true, about: "the template: a [[page]], a ((block)), a Work ID, or type:<kind> for the note that says [template-for::<kind>]. The person is asked when it is left out" },
      as: { type: "string", optional: true, about: "new (a new note), the only placement so far" },
      into: { type: "string", optional: true, about: "((id^anchor)): writing into a note's anchor arrives with place(); refused here with where it is coming" },
      parent: { type: "string", optional: true, about: "the note the new note goes under: a [[page]], a ((block)), an id or a Work ID. Left out: the top of the Inbox" },
      title: { type: "string", optional: true, about: "the new note's title, in place of the template's first line's words; may hold the stamp's own values: {{now.date}}, {{props.who}}" },
      for: { type: "string", optional: true, about: "a query (the views' grammar): stamp once per note it matches, each as props.for ({{props.for.title}}); a match already stamped from this template is skipped" },
      freeze: { type: "string", optional: true, about: "all: write the values of this.x, parent.x, bare keys and references too" },
      with: { type: "string", optional: true, about: "the template's props, as JSON: names to text" },
    },
    async run({ of, as, into, parent, title, for: forQuery, freeze, with: w }, { ctx }, actor: Actor) {
      const given = propsOf(w);
      const request = (template: string, props: Record<string, string>) => ({
        of: template, ...(as !== undefined ? { as } : {}), ...(into !== undefined ? { into } : {}), ...(parent !== undefined ? { parent } : {}),
        ...(title !== undefined ? { title } : {}), ...(forQuery !== undefined ? { for: forQuery } : {}), ...(freeze !== undefined ? { freeze } : {}),
        ...(Object.keys(props).length ? { props } : {}),
      });
      const stamp = async (template: string, props: Record<string, string>) => {
        let out;
        try { out = await ctx.board.templateStamp(request(template, props), actor); }
        catch (e) { throw new ActionRefused(`not stamped: ${e instanceof Error ? e.message : String(e)}`); }
        const first = out.stamped[0];
        if (actor.kind === "user" && first && ctx.press) { await ctx.press("open", { id: first.id }); ctx.flash(out.said, 8000); }
        ctx.redraw();
        return out;
      };
      // The props the template declares and the person didn't give: asked in the bar, each in the picker of its kind.
      const withProps = async (template: string) => {
        if (actor.kind !== "user") return stamp(template, given);
        let declared: PropsSpec;
        try { declared = (await ctx.board.templateProps(template)).spec; } catch (e) { throw new ActionRefused(`not stamped: ${e instanceof Error ? e.message : String(e)}`); }
        const questions = asked(declared, given);
        if (!questions.length) return stamp(template, given);
        return askInBar(ctx as never, `Stamp ${template}`, questions, given, actor, answers => stamp(template, { ...given, ...answers }));
      };
      if (of !== undefined) return withProps(of);
      if (actor.kind !== "user") throw new ActionRefused("template.stamp needs of=: the template ([[page]], ((id)), a Work ID, or type:meeting); for example of='[[daily-template]]' as=new");
      // No template named: the person picks one of the outline's templates (or any note), by its words.
      const templates = async (typed: string) => {
        const { notes } = await ctx.board.queryNotes("type=template", 50);
        const words = typed.trim().toLowerCase();
        return notes.filter(n => !words || subject(n).toLowerCase().includes(words)).slice(0, 20).map(n => ({ value: n.id, label: subject(n), detail: "a template" }));
      };
      return askInBar(ctx as never, "Stamp a template", [{ name: "of", type: "note", label: "template", suggest: templates, found: "a note to use as the template" }], {}, actor, answers => withProps(answers.of!));
    },
  }),
});
