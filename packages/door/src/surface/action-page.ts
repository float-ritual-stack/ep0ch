// An action's page (PIE-1032): what it does in one line, then its keys, its arguments and one or two real calls, each
// drawn by a component the outline already has, never a paragraph. The page is Blockdown, written from the action's
// declarations (its ActionDef: `summary`, `keys`, `args`, `examples`, `touches`), so one source draws it everywhere: the
// power bar's preview (through the readers' renderers), `ep0ch actions --doc <name>`, and a docs note a seeder writes
// (PIE-985). The rows are written out, never `actions:` asked of the registry, so the page draws where there is none.
//
//   **layout.move** · move a tile beside another, into its tabs, or to an edge
//   ::graph-keys       its keys as keycaps, every way to press it (figures/keys.ts keyAlternatives)
//   ::graph-example    its examples as act lines, what each does, `safe` on one an agent may run (figures/example.ts)
//   ::graph-props      its arguments: name, values, default or needed, what each means (figures/props.ts)
//   - one fact a line, the rest of the summary, last: what a short preview cuts first
import { keyAlternatives } from "../figures/keys";
import type { ActionExample, ActionInfo, ArgSpec } from "./actions";

/** What the page says beside the declarations: a reason it can't run now (the bar's refused row), a hyper chord. */
export interface PageExtras { refused?: string; hyper?: readonly string[]; title?: string }

/**
 * Text that stays words when the page is a note: a `::component`, a `[[page]]` or `((ref))` written in a summary is put
 * in a code span, so it is never a property, a component or a link of the page's note; in prose (`keyValues`) a
 * `key=value` too, so it reads as code. A figure's rows are drawn as written, so they get only the first.
 */
export function inert(text: string, keyValues = true): string {
  const risky = keyValues ? /(?<![\w`])(?:[a-z][\w.-]*=(?:<[^>]*>|"[^"]*"|[^\s,;)<"]+)+|\S*(?:::|\[\[|\(\(|\]\]|\)\))\S*)/g : /\S*(?:::|\[\[|\(\(|\]\]|\)\))\S*/g;
  return text.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part
    : part.replace(risky, m => {
      // Punctuation that ends the sentence stays outside the span.
      const tail = /[.,;:]+$/.exec(m)?.[0] ?? "";
      return "`" + m.slice(0, m.length - tail.length) + "`" + tail;
    }))).join("");
}

/** The summary's lead: up to its first `.`, `:`, `;` or `(`, as the bar's rows and the keys sheet cut it. */
export const actionLead = (summary: string): string => summary.split(/[.:;(]/)[0]!.trim().replace(/[,]$/, "");

/** The summary's sentences, a fact each: split after `.` or `;` before the next word. */
function facts(summary: string): string[] {
  return summary.split(/(?<=[.;])\s+(?=[A-Za-z(`])/).map(s => s.trim().replace(/;$/, "")).filter(Boolean);
}

/** Each kind of thing an argument names, in words (ArgKind). */
const KIND_WORDS: Record<NonNullable<ArgSpec["kind"]>, string> = {
  layout: "a layout", file: "a file", outline: "an outline", tile: "a tile", note: "a note", page: "a page", screen: "a screen", view: "a saved view", key: "a property", value: "a property's value", "tile-kind": "a tile kind",
};
/** What an argument takes, in words: its choices, a tile, a note, text, a number, true or false. */
export const valuesOf = (s: ArgSpec): string => {
  const kind = s.kind ? KIND_WORDS[s.kind] : null;
  if (s.choices?.length) return `${s.choices.join(", ")}${kind ? ` or ${kind}` : ""}`;
  return kind ?? (s.type === "number" ? "a number" : s.type === "boolean" ? "true or false" : "text");
};

/** What a left-out optional argument means, when it says: its `default`, or a short "(default x)" ending what it means. */
export function argDefault(s: ArgSpec): { value?: string; about: string } {
  const said = s.default === undefined ? /\s*\(default ([^()]{1,24})\)\s*$/.exec(s.about) : null;
  const value = s.default ?? said?.[1];
  return { ...(value !== undefined ? { value } : {}), about: said ? s.about.slice(0, said.index) : s.about };
}

/** Whether an agent may run an example as it is: it says so, or the action only reads or changes the door's own view. */
export function exampleSafe(info: Pick<ActionInfo, "touches" | "replay" | "person">, ex: ActionExample): boolean {
  return ex.safe ?? (info.touches === "nothing" && info.replay === "safe" && !info.person);
}

/** A figure block: its title in its YAML, its rows after. */
const figure = (kind: string, yaml: Record<string, string>, rows: string[]) =>
  [`::graph-${kind}`, "---", ...Object.entries(yaml).map(([k, v]) => `${k}: ${v}`), "---", ...rows, "::"].join("\n");

/** The page of action `info`, as Blockdown. */
export function actionPage(info: ActionInfo, extras: PageExtras = {}): string {
  const out: string[] = [];
  const lead = actionLead(info.summary);
  out.push(`**${extras.title ?? info.name}** · ${inert(lead)}${extras.title && extras.title !== info.name ? ` · \`${info.name}\`` : ""}`);
  if (extras.refused) out.push("", "> [!warning] Not now", `> ${inert(extras.refused)}`);
  if (info.person) out.push("", "> [!note] The person's own", "> An agent's is refused; it says what an agent does instead.");
  const keys = keyAlternatives(info.keys);
  for (const h of extras.hyper ?? []) keys.push({ keys: h, action: "hyper" });
  if (keys.length) out.push("", figure("keys", { title: "keys" }, keys.map(k => `- ${k.keys}:${k.action ? ` ${inert(k.action, false)}` : ""}`)));
  const examples = info.examples ?? [];
  if (examples.length) {
    out.push("", figure("example", { title: "examples", prompt: "ep0ch act" }, examples.map(ex =>
      `- \`${ex.act}\` → ${inert(ex.does.replace(/ — /g, ", "), false)}${exampleSafe(info, ex) ? " (safe)" : ""}`)));
  }
  const args = Object.entries(info.args);
  if (args.length) {
    out.push("", figure("props", { title: "arguments" }, args.map(([name, s]) => {
      // A short "(default x)" at the end of what it means is its default column.
      const { value: dflt, about } = argDefault(s);
      const values = valuesOf(s) + (dflt !== undefined ? ` · ${dflt}` : "");
      return `- ${s.optional ? name : `**${name}**`}: ${values} — ${inert(about.replace(/ — /g, ", "), false)}`;
    })));
  }
  if (info.answer) out.push("", figure("props", { title: "answer" }, Object.entries(info.answer).map(([name, s]) => `- ${name}: ${s.type} — ${inert(s.about, false)}`)));
  // The rest of what it says, a fact a line, last: what a short preview cuts first.
  const rest = facts(info.summary).filter((f, i) => !(i === 0 && f.replace(/[.;]$/, "") === lead));
  if (rest.length) out.push("", ...rest.map(f => `- ${inert(f)}`));
  out.push("", `*touches ${info.touches}${info.varies ? " at most" : ""}${info.repaints === undefined ? "" : info.repaints === "answer" ? " · repaints when its answer says so" : info.repaints ? " · always repaints" : " · never repaints"} · ${info.replay === "safe" ? "a restarted door may run it again" : "a restarted door asks before running it again"}*`);
  return out.join("\n");
}
