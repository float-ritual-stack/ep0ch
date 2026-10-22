import { actionScript } from "@ep0ch/outline-core/action-line";
import { CodemodeSandbox, type CodemodeResult } from "@earendil-works/pi-codemode";
import type { HostApi, RenderHostApi } from "./host-api";
import { PRIMITIVE_TYPES } from "./component-primitives";

/**
 * The Site a script runs in (PIE-533): the note it is about (`this`), its own note (`self`), where it was invoked
 * (`caller`) and its arguments (`props`, `week=42` as `props.week`). Each is plain data, frozen; `this` is a note's
 * record and refuses every read when the run has none.
 */
export interface ScriptSiteGlobals {
  input?: unknown;
  this?: unknown;
  self?: unknown;
  caller?: unknown;
  props?: Record<string, string[]>;
}

const NO_NOTE = "this run has no note; pass at= or run it from a note";

/** The script's globals as source: frozen data, and a `this` that says why it is empty when the run has no note. */
function siteSource(site: ScriptSiteGlobals): string {
  const data = (name: string, value: unknown) => `const ${name} = __freeze(JSON.parse(${JSON.stringify(JSON.stringify(value ?? null))}));`;
  return [
    "const __freeze = o => { if (o && typeof o === 'object') { for (const v of Object.values(o)) __freeze(v); Object.freeze(o); } return o; };",
    site.input === undefined ? "const input = undefined;" : data("input", site.input),
    data("self", site.self),
    data("caller", site.caller),
    data("props", site.props ?? {}),
    site.this === undefined
      ? `const __this = new Proxy({}, { get: () => { throw new Error(${JSON.stringify(NO_NOTE)}); } });`
      : data("__this", site.this),
  ].join("\n");
}

/** The VM runs on a worker so a computing script never holds the outline's event loop. */
export async function runScript(source: string, api: HostApi | RenderHostApi, signal?: AbortSignal, actions?: Record<string, string>, site: ScriptSiteGlobals = {}): Promise<CodemodeResult> {
  if (actions) source = actionScript(source, actions);
  const sandbox = new CodemodeSandbox({
    tools: api.tools.map(name => ({ name, execute: args => api.call(name, args as Record<string, unknown>) })),
    globals: [
      ...("act" in api ? [{ name: "act", spread: true as const, execute: (args: unknown) => api.act(...args as Parameters<HostApi["act"]>) }] : []),
      { name: "q", spread: true, execute: args => api.q(...args as Parameters<HostApi["q"]>) },
      { name: "read", spread: true, execute: args => api.read(...args as Parameters<HostApi["read"]>) },
      ...("place" in api ? [{ name: "place", spread: true as const, execute: (args: unknown) => api.place(...args as Parameters<HostApi["place"]>) }] : []),
      { name: "resolve", spread: true, execute: args => api.resolve(...args as Parameters<HostApi["resolve"]>) },
      // Bounded by the run: it ends with the run, and the run's deadline (the signal's) cuts it short.
      { name: "wait", spread: true, execute: args => wait(Number((args as unknown[])[0]), signal) },
    ],
  });
  try {
    const views = `const view = Object.fromEntries(${JSON.stringify(PRIMITIVE_TYPES)}.map(type => [type, props => ({ ...props, type })]));`;
    const toolScope = "act" in api ? "" : `const tools = Object.fromEntries(${JSON.stringify(api.tools)}.map(name => [name, globalThis.tools[name]]));`;
    const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(`${views}\n${siteSource(site)}\nasync function __ep0ch_script__() {\n${source}\n}`) + "\nreturn await __ep0ch_script__.call(__this);";
    return await sandbox.execute(toolScope ? `{${toolScope}\n${javascript}\n}` : javascript, { signal });
  } finally {
    await sandbox.close();
  }
}

/** `wait(ms)`: sleeps, or ends with the run (its deadline, its stop). */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) return Promise.reject(new Error("wait(ms) takes a number of milliseconds, such as wait(500)"));
  const ended = () => signal?.reason instanceof Error ? signal.reason : new Error("The script run ended");
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(ended());
    const stop = () => { clearTimeout(timer); reject(ended()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}
