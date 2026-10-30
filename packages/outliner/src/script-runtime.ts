import { actionScript } from "@ep0ch/outline-core/action-line";
import { CodemodeSandbox, type CodemodeResult } from "@earendil-works/pi-codemode";
import type { HostApi, RenderHostApi } from "./host-api";
import { PRIMITIVE_FIELDS, PRIMITIVE_TYPES } from "./component-primitives";

/** A fence whose code is JSX (`tsx`, `jsx`): its tags are view primitives. A `ts`/`js` fence stays TypeScript, so `<T>x` is a cast. */
export const isJsxLanguage = (language: string | undefined) => language === "tsx" || language === "jsx";

const transpilers = new Map<boolean, Bun.Transpiler>();
/**
 * Script code as the VM runs it: TypeScript, or with `jsx` TSX whose tags call the prelude's `__h` (classic JSX, so no
 * runtime import). The one transpile a run's script and the modules it imports (script-link.ts) go through.
 */
export function transpileScript(code: string, jsx = false): string {
  let transpiler = transpilers.get(jsx);
  if (!transpiler) transpilers.set(jsx, transpiler = jsx
    ? new Bun.Transpiler({ loader: "tsx", tsconfig: { compilerOptions: { jsx: "react", jsxFactory: "__h", jsxFragmentFactory: "__Fragment" } } as never })
    : new Bun.Transpiler({ loader: "ts" }));
  return transpiler.transformSync(code);
}

/**
 * The view builders (`view.card({…})`) and JSX's `__h`: a primitive's tag makes that primitive with its attributes; text
 * children are a leaf's `text` (or `label`), the rest its `children` (a string there is a text primitive); a fragment
 * (`<>…</>`) is a stack; a function tag is a component of the script's own, called with its attributes and `children`.
 */
const VIEW_PRELUDE = `const view = Object.fromEntries(${JSON.stringify(PRIMITIVE_TYPES)}.map(type => [type, props => ({ ...props, type })]));
const __FIELDS = ${JSON.stringify(PRIMITIVE_FIELDS)};
const __Fragment = "__ep0ch_fragment";
const __kids = (list, out) => { for (const c of list) { if (Array.isArray(c)) __kids(c, out); else if (c !== null && c !== undefined && c !== false && c !== true && c !== "") out.push(c); } return out; };
const __leaf = c => typeof c === "object" ? c : { type: "text", text: String(c) };
const __h = (tag, attrs, ...children) => {
  const kids = __kids(children, []);
  if (typeof tag === "function") return tag({ ...attrs, children: kids });
  if (tag === __Fragment) return { type: "stack", children: kids.map(__leaf) };
  const fields = Object.prototype.hasOwnProperty.call(__FIELDS, tag) ? __FIELDS[tag] : undefined;
  if (!fields) throw new Error("<" + tag + "> is no view primitive; the primitives are " + Object.keys(__FIELDS).join(", "));
  const { key: _key, ...rest } = attrs ?? {};
  const node = { ...rest, type: tag };
  if (fields.includes("children")) { if (kids.length || tag !== "card") node.children = [...(Array.isArray(rest.children) ? rest.children : []), ...kids.map(__leaf)]; }
  else if (kids.length) {
    const field = fields.includes("text") ? "text" : fields.includes("label") ? "label" : undefined;
    if (!field || kids.some(c => typeof c === "object")) throw new Error("<" + tag + "> takes no child primitives" + (field ? "; its " + field + " is text" : ""));
    node[field] = kids.join("");
  }
  return node;
};`;

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

/**
 * How a run's code is read: `jsx` for a tsx/jsx fence; `modules`, the notes it imports already linked (script-link.ts:
 * their definitions, as JavaScript, which the code's rewritten imports call).
 */
export interface ScriptCodeOptions { jsx?: boolean; modules?: string }

/** The VM runs on a worker so a computing script never holds the outline's event loop. */
export async function runScript(source: string, api: HostApi | RenderHostApi, signal?: AbortSignal, actions?: Record<string, string>, site: ScriptSiteGlobals = {}, code: ScriptCodeOptions = {}): Promise<CodemodeResult> {
  if (actions) source = actionScript(source, actions);
  const sandbox = new CodemodeSandbox({
    tools: api.tools.map(name => ({ name, execute: args => api.call(name, args as Record<string, unknown>) })),
    globals: [
      ...("act" in api ? [{ name: "act", spread: true as const, execute: (args: unknown) => api.act(...args as Parameters<HostApi["act"]>) }] : []),
      // An action run's reach past the outline; each ends with the run (the signal: its deadline, its stop).
      ...("act" in api ? [
        { name: "sh", spread: true as const, execute: (args: unknown) => { const [argv, options] = args as Parameters<HostApi["sh"]>; return api.sh(argv, options, signal); } },
        { name: "fetch", spread: true as const, execute: (args: unknown) => { const [url, init] = args as Parameters<HostApi["fetch"]>; return api.fetch(url, init, signal); } },
      ] : []),
      { name: "q", spread: true, execute: args => api.q(...args as Parameters<HostApi["q"]>) },
      { name: "read", spread: true, execute: args => api.read(...args as Parameters<HostApi["read"]>) },
      { name: "query", spread: true, execute: args => api.query(...args as Parameters<HostApi["query"]>) },
      ...("place" in api ? [{ name: "place", spread: true as const, execute: (args: unknown) => api.place(...args as Parameters<HostApi["place"]>) }] : []),
      { name: "resolve", spread: true, execute: args => api.resolve(...args as Parameters<HostApi["resolve"]>) },
      // Bounded by the run: it ends with the run, and the run's deadline (the signal's) cuts it short.
      { name: "wait", spread: true, execute: args => wait(Number((args as unknown[])[0]), signal) },
    ],
  });
  try {
    const toolScope = "act" in api ? "" : `const tools = Object.fromEntries(${JSON.stringify(api.tools)}.map(name => [name, globalThis.tools[name]]));`;
    const javascript = transpileScript(`${VIEW_PRELUDE}\n${siteSource(site)}\nasync function __ep0ch_script__() {\n${source}\n}`, code.jsx)
      + (code.modules ? `\n${code.modules}` : "") + "\nreturn await __ep0ch_script__.call(__this);";
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
