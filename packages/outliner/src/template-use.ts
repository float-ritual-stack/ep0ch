// `template.use` (PIE-533 S4): the call written on a `::use{of=[[meeting-template]] date=… with=…}` line, resolved. The
// service reads the line from the note that writes it, finds the template (templates.ts), resolves each prop's value in
// the caller's Site (a `{{ }}` or a path headed by a reference is read through `site.answer`'s one resolver, never
// pasted), checks the call against the template's declared props (outline-core's props-spec.ts) and answers what a client
// draws: the template's text, the chain to draw its body in (`this` stays the host), the props, and what is wrong with the
// call, said as an unresolved `{{ }}` is. The body's own `{{ }}`, figures, `::fields` and `::if` are read by
// `site.answer` with that chain and those props; nothing here resolves them. Reads only.
import { interpolationSpans } from "@ep0ch/outline-core/interpolation";
import { checkProps } from "@ep0ch/outline-core/props-spec";
import type { PropsSpec, SiteAnswer, SiteLink } from "@ep0ch/outline-core/site";
import { propValueSource, useCallAt, type TemplateUseAnswer, type TemplateUseRequest, type UseProblem } from "@ep0ch/outline-core/template-use";
import { blockDisplayTitle } from "./references";
import { answerSite, type SiteStore } from "./site-answer";
import { findTemplate, templateProps, type TemplateStore } from "./templates";

export type TemplateUseStore = SiteStore & TemplateStore;

const MAX_CHAIN = 8;

/** A prop's text to read in the caller's Site: its `{{ }}` spans, or one path. */
interface ToRead { name: string; text: string; paths: string[]; fill: (values: string[][]) => string }

function readPlan(name: string, text: string): ToRead | null {
  const source = propValueSource(text);
  if (source.kind === "path") return { name, text, paths: [source.path], fill: values => values[0]!.join(", ") };
  if (source.kind !== "template") return null;
  const spans = interpolationSpans(text, { fences: "template" });
  if (!spans.length) return null;
  return {
    name, text, paths: spans.map(span => span.expression),
    fill: values => { let out = "", at = 0; spans.forEach((span, i) => { out += text.slice(at, span.start) + values[i]!.join(", "); at = span.end; }); return (out + text.slice(at)).replaceAll("\\{{", "{{"); },
  };
}

export function templateUse(store: TemplateUseStore, request: TemplateUseRequest, clock: () => number = Date.now): TemplateUseAnswer {
  if (!request || typeof request !== "object" || typeof request.block !== "string" || !request.block.trim() || !Number.isInteger(request.line) || request.line < 0) {
    throw new Error("template.use needs block (the note the ::use is written in) and line (from 0); for example { block: \"PIE-12\", line: 3 }");
  }
  const given = request.chain ?? [];
  if (!Array.isArray(given) || given.length >= MAX_CHAIN) throw new Error(`chain is the invocations that draw the host, outermost first (at most ${MAX_CHAIN - 1} here, since this use is one more)`);
  const host = store.resolveBlockRef(request.block);
  const text = request.draft?.text ?? host.text;
  const lines = text.split("\n");
  const call = useCallAt(lines, request.line);
  if (!call) throw new Error(`line ${request.line + 1} of ((${host.id.slice(0, 8)})) holds no ::use (it holds ${JSON.stringify((lines[request.line] ?? "").slice(0, 60))}); a call is ::use{of=[[meeting-template]] key=value}`);

  const route: string[] = [`::use on line ${request.line + 1} of ((${host.id.slice(0, 8)}))${request.draft ? " (the draft text)" : ""}`];
  const deps = new Set<string>([host.id]);
  const problems: UseProblem[] = [];
  let anyChange = false, clock_: "minute" | undefined;
  const chain: SiteLink[] = [...given, { kind: "use", block: host.id, line: request.line, mark: lines[request.line]!.trim() }];
  const base = { host: host.id, line: request.line, chain, route };
  const answer = (rest: Partial<TemplateUseAnswer>): TemplateUseAnswer => ({
    ...base, props: {}, spec: {}, problems, missing: [], deps: [...deps].sort(), ...(anyChange ? { anyChange: true as const } : {}), ...(clock_ ? { clock: clock_ } : {}), ...rest,
  });

  if (call.problem || !call.of) {
    problems.push({ kind: "of", message: call.problem ?? "::use names no template", didYouMean: [], example: "::use{of=[[meeting-template]]}" });
    return answer({});
  }
  const found = findTemplate(store, call.of);
  if (!found.ok) {
    // A page that doesn't exist yet may be written later: any change can fill it.
    anyChange = true;
    problems.push({ kind: "of", message: found.message, didYouMean: found.didYouMean, ...(found.example ? { example: found.example } : {}) });
    return answer({});
  }
  const template = found.block;
  deps.add(template.id);
  route.push(`template ((${template.id.slice(0, 8)})): ${found.how}`);
  const title = blockDisplayTitle(template);
  const info = { id: template.id, title, revision: template.revision, text: template.text, how: found.how };
  // A template that draws itself, or is already being drawn above this line, would never end.
  if (template.id === host.id || given.some(link => link.block === template.id)) {
    problems.push({ kind: "cycle", message: `${title} is drawing itself: this ::use is inside ${template.id === host.id ? "the template it names" : "a note that template draws"}`, didYouMean: [], example: "use a different template here, or write the lines out" });
    return answer({ template: info });
  }

  for (const word of call.reserved) {
    problems.push({ kind: "unknown", prop: word.key, message: `\`${word.key}\` is a call-site word that ::use doesn't read (${word.key === "as" || word.key === "freeze" || word.key === "for" ? "template.stamp takes it" : "a button or a script takes it"}); a prop is a name the template declares`, didYouMean: [] });
  }
  const declared = templateProps(template);
  for (const message of declared.problems) problems.push({ kind: "spec", message: `${title}: ${message}`, didYouMean: [] });
  const spec = { ...declared.spec };

  // What to read in the caller's Site: prop values that are paths, and defaults that are.
  const plans: ToRead[] = [];
  const texts = call.props.map(({ key, value }) => ({ key, value }));
  for (const { key, value } of texts) { const plan = readPlan(key, value); if (plan) plans.push(plan); }
  const givenNames = new Set(texts.map(t => t.key.toLowerCase()));
  for (const [name, field] of Object.entries(spec)) {
    if (field.default === undefined || givenNames.has(name.toLowerCase())) continue;
    const plan = readPlan(`default:${name}`, field.default);
    if (plan) plans.push(plan);
  }
  const read = new Map<string, string | null>();
  if (plans.length) {
    const asked: string[] = plans.flatMap(plan => plan.paths);
    let hostAnswer: SiteAnswer | undefined;
    try {
      hostAnswer = answerSite(store, {
        blockId: host.id, line: request.line, ...(given.length ? { chain: given } : {}), ...(request.props ? { props: request.props } : {}),
        ...(request.draft ? { draft: request.draft } : {}), paths: asked,
      }, clock);
    } catch (error) {
      problems.push({ kind: "path", message: `a prop's path can't be read here: ${error instanceof Error ? error.message : String(error)}`, didYouMean: [] });
    }
    if (hostAnswer) {
      for (const id of hostAnswer.deps) deps.add(id);
      if (hostAnswer.anyChange) anyChange = true;
      if (hostAnswer.clock) clock_ = "minute";
      let at = 0;
      for (const plan of plans) {
        const reads = (hostAnswer.paths ?? []).slice(at, at + plan.paths.length);
        at += plan.paths.length;
        const bad = reads.find(v => v.problem && !v.usedDefault);
        const label = plan.name.startsWith("default:") ? `${plan.name.slice(8)}'s default` : plan.name;
        if (bad) {
          problems.push({ kind: "path", prop: plan.name.replace(/^default:/, ""), message: `${label}=${plan.text}: ${bad.problem!.message}`, didYouMean: bad.problem!.didYouMean, ...(bad.problem!.example ? { example: bad.problem!.example } : {}) });
          read.set(plan.name, null);
        } else {
          read.set(plan.name, plan.fill(reads.map(v => v.values ?? [])));
          route.push(`${label} = ${plan.text} → ${read.get(plan.name)}`);
        }
      }
    }
  }
  const resolved = texts.flatMap(({ key, value }) => {
    if (!read.has(key)) return [{ key, value }];
    const v = read.get(key);
    return v === null || v === undefined ? [] : [{ key, value: v }];
  });
  for (const [name, field] of Object.entries(spec)) {
    const v = read.get(`default:${name}`);
    if (v === undefined) continue;
    if (v === null) delete spec[name]; else spec[name] = { ...field, default: v };
  }
  const checked = checkProps(spec, resolved, title, call.of);
  for (const problem of checked.problems) problems.push(problem);
  return answer({ template: info, props: checked.values, spec: declared.spec, missing: checked.missing });
}

/** `template.props`: the props a template declares (what a person is asked for when they stamp or use it), and how it was found. */
export function templatePropsOf(store: TemplateUseStore, request: { of: string }): { template: { id: string; title: string; how: string }; spec: PropsSpec; problems: string[] } {
  if (!request || typeof request.of !== "string" || !request.of.trim()) throw new Error("template.props needs of: the template ([[page]], ((id)), a Work ID, or type:meeting)");
  const found = findTemplate(store, request.of);
  if (!found.ok) throw new Error(`${found.message}${found.didYouMean.length ? `; did you mean ${found.didYouMean.join(" or ")}?` : ""}`);
  const declared = templateProps(found.block);
  return { template: { id: found.block.id, title: blockDisplayTitle(found.block), how: found.how }, spec: declared.spec, problems: declared.problems };
}
