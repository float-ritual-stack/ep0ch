// Named actions: everything a person does to a note (edit, save, quote a passage, comment, reply,
// resolve, follow a link) and a host adds (open a note in a reader, move a card), with typed arguments.
// Keys call them, and so does the control socket (`ep0ch-door act`), through the same code. An agent's
// action is never silent: the status bar says "an agent (<id>) …", the reader it touched says what it
// did, and what it writes is recorded as `author: agent` with its actor id.
import type { Actor } from "../socket";

export type ArgType = "string" | "number" | "boolean";
/** One argument: its type, whether it may be left out, and what it means. */
export interface ArgSpec { type: ArgType; optional?: boolean; about: string }

export interface ActionDef<A, H> {
  /** What the action does, in the words `actions` and the README use. */
  summary: string;
  /** The key that does the same thing, when there is one. */
  keys?: string;
  args: { [K in keyof A]-?: ArgSpec };
  run(args: A, host: H, actor: Actor): Promise<unknown> | unknown;
}

/** An action as `ep0ch-door actions` lists it. */
export interface ActionInfo { name: string; summary: string; keys?: string; args: Record<string, ArgSpec>; scope: string }

/** What the control socket sends: an action on the current screen, in one of its readers, as someone. */
export interface ActRequest { action: string; reader?: string; args?: Record<string, unknown>; as?: string }

/** An action refused before anything happened, with the reason in plain words. */
export class ActionRefused extends Error {
  constructor(message: string) { super(message); this.name = "ActionRefused"; }
}

/**
 * A set of actions over one kind of host. `M` maps each action name to its argument object, so a
 * caller in code gets its arguments checked by the compiler, and one from the socket gets them
 * checked (and coerced from strings) here.
 */
export class ActionSet<M extends { [K in keyof M]: object }, H> {
  constructor(readonly scope: string, private readonly defs: { [K in keyof M]: ActionDef<M[K], H> }) {}

  has(name: string): name is Extract<keyof M, string> { return Object.hasOwn(this.defs, name); }

  list(): ActionInfo[] {
    return (Object.keys(this.defs) as (keyof M & string)[]).map(name => {
      const d = this.defs[name];
      return { name, summary: d.summary, keys: d.keys, args: d.args as Record<string, ArgSpec>, scope: this.scope };
    });
  }

  /** Run an action with arguments already typed (keys, code). */
  run<K extends keyof M & string>(name: K, args: M[K], host: H, actor: Actor): Promise<unknown> {
    return Promise.resolve(this.defs[name].run(args, host, actor));
  }

  /** Run an action named on the wire: unknown names and wrong arguments are refused before it starts. */
  runUntyped(name: string, raw: Record<string, unknown>, host: H, actor: Actor): Promise<unknown> {
    if (!this.has(name)) throw new ActionRefused(`no action ${name} here; try: ${Object.keys(this.defs).join(", ")}`);
    return this.run(name, coerce(name, this.defs[name].args as Record<string, ArgSpec>, raw) as any, host, actor);
  }
}

function coerce(action: string, spec: Record<string, ArgSpec>, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!(k in spec)) throw new ActionRefused(`${action} takes no ${k}; it takes ${Object.keys(spec).join(", ") || "nothing"}`);
  for (const [k, s] of Object.entries(spec)) {
    const v = raw[k];
    if (v === undefined || v === null) { if (!s.optional) throw new ActionRefused(`${action} needs ${k} (${s.about})`); continue; }
    if (s.type === "string") { if (typeof v !== "string" && typeof v !== "number") throw new ActionRefused(`${action}: ${k} is text`); out[k] = String(v); }
    else if (s.type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) throw new ActionRefused(`${action}: ${k} is a number, not ${JSON.stringify(v)}`);
      out[k] = n;
    } else {
      const b = typeof v === "boolean" ? v : v === "true" || v === "1" || v === "yes" ? true : v === "false" || v === "0" || v === "no" ? false : null;
      if (b === null) throw new ActionRefused(`${action}: ${k} is true or false, not ${JSON.stringify(v)}`);
      out[k] = b;
    }
  }
  return out;
}

/** "an agent (claude-7)": how the door names an agent on screen. */
export const agentLabel = (actor: Actor) => (actor.kind === "agent" ? `an agent (${actor.id})` : "you");

/**
 * A context whose flashes say who did it: while an agent's action runs (and when its save or send lands
 * later), every message it raises starts with "an agent (<id>) · ". Everything else passes through.
 */
export function asActor<T extends { flash(msg: string): void }>(ctx: T, actor: Actor): T {
  if (actor.kind !== "agent") return ctx;
  const prefix = `${agentLabel(actor)} · `;
  return new Proxy(ctx, {
    get(target, p) {
      if (p === "flash") return (m: string) => target.flash(m.startsWith(prefix) ? m : prefix + m);
      const v = Reflect.get(target, p, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/**
 * `key=value` words from the command line: `reader=` and `as=` go to the request, the rest are the
 * action's arguments. A value `@path` is read from that file and `@-` from stdin, so long text needn't
 * be quoted.
 */
export async function parseActArgs(words: string[], stdin: () => Promise<string> = () => Bun.stdin.text()): Promise<ActRequest> {
  const [action, ...rest] = words;
  if (!action) throw new ActionRefused("act needs an action name; `actions` lists them");
  const req: ActRequest = { action, args: {} };
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    if (w === "--as" || w === "--reader") { const v = rest[++i]; if (v === undefined) throw new ActionRefused(`${w} needs a value`); if (w === "--as") req.as = v; else req.reader = v; continue; }
    const eq = w.indexOf("=");
    if (eq <= 0) throw new ActionRefused(`arguments are key=value, not ${JSON.stringify(w)}`);
    const k = w.slice(0, eq);
    let v = w.slice(eq + 1);
    if (v === "@-") v = (await stdin()).replace(/\n$/, "");
    else if (v.startsWith("@") && v.length > 1) v = (await Bun.file(v.slice(1)).text()).replace(/\n$/, "");
    if (k === "reader") req.reader = v;
    else if (k === "as") req.as = v;
    else req.args![k] = v;
  }
  return req;
}
