// The door in the browser (spike, Oct 11): the real ep0ch door, its editor, completer, composer, callouts and figures,
// in a tailnet page, with no second implementation. Each page is one more terminal attached to the outline's door
// session (PIE-418: one session per outline, many terminals), the same session the person reaches over ssh. The
// terminal is ptyZZZ (github.com/e-schultz/ptyZZZ, a fork of cablehead/ptyZZZ): a pty plus wezterm-term on this side,
// semantic key, paste, mouse and resize events in as JSONL, screen keyframes and row diffs out as HTML. The publisher
// spawns it per page, streams its frames to the page over SSE and passes the page's events to its stdin.
//
// It is a terminal, effectively shell-adjacent (the door's drop shell is a key away), so it is served on the tailnet
// listener only: never the public listener, never below a share link, not yet the signed-in origin. Requests must come
// from the page's own origin (Sec-Fetch-Site / Origin), and a stream or input names a terminal by an unguessable id.
//
// The door is told it's in a terminal without Kitty graphics or text sizing through the variables its Display already
// reads (EP0CH_KITTY=0, EP0CH_SIZED=0): figures draw as cells, titles at one height.
//
//   <base>/door?open=<block id>   the page: a full-viewport terminal opening that note in the door's detail screen
//   <base>/door/stream?t=<id>     SSE: ptyZZZ's frames for terminal <id>, started on first connect
//   <base>/door/input?t=<id>      POST: ptyZZZ commands (JSONL) for terminal <id>
//   <base>/door/stats             JSON: each terminal's frames and bytes (the spike's measurements)
//   <base>/door/door.js, client.js, fonts/<file>   the page's script, ptyZZZ's mouse adapter, the terminal font
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** ptyZZZ's mouse adapter, vendored from e-schultz/ptyZZZ at this commit (static/ptyzzz-client.js, MIT). */
export const PTYZZZ_COMMIT = "bf0f730d6445cb11e4f75d40f4b8fe3912e6d75f";
const CLIENT_SCRIPT = readFileSync(new URL("./publish-door-ptyzzz-client.js", import.meta.url), "utf8");
const PAGE_SCRIPT = readFileSync(new URL("./publish-door-page.js", import.meta.url), "utf8");

/** Variables a page's terminal doesn't take from the publisher: they name the publisher's own terminal, not this one. */
const DROPPED = ["TERM", "COLORTERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TMUX", "TMUX_PANE", "STY", "HERDR_PANE_ID", "HERDR_TAB_ID", "KITTY_WINDOW_ID", "GHOSTTY_RESOURCES_DIR", "EP0CH_NEST", "EP0CH_IN_DOOR", "EP0CH_TILE", "EP0CH_TILE_ID", "EP0CH_PLACE", "SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"];
const TERMINAL_ID = /^[A-Za-z0-9_-]{16,64}$/;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface WebDoorOptions {
  /** The ptyZZZ checkout: its binary at target/release/ptyZZZ, its font at static/fonts/. */
  ptyzzz: string;
  /** What runs in a page's pty: the door attached to the outline's session, opening `open` when given. */
  command: (open: string | undefined) => string[];
  /** The environment it runs in (default: this process's). */
  env?: Record<string, string | undefined>;
  /** At most this many terminals at once (default 4). */
  max?: number;
  /** A terminal nobody watches ends after this long (default 15 s: a reload reattaches to it). */
  graceMs?: number;
  log?: (line: string) => void;
}

interface Terminal {
  id: string;
  proc: Bun.Subprocess<"pipe", "pipe", "ignore">;
  /** The last keyframe line, for a stream that (re)connects. */
  keyframe: string | null;
  watchers: Set<(line: string) => void>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  started: number;
  stats: { keyframes: number; diffs: number; bytesOut: number; inputs: number; bytesIn: number };
}

export class WebDoor {
  private readonly terminals = new Map<string, Terminal>();
  private readonly binary: string;
  private readonly log: (line: string) => void;

  constructor(private readonly options: WebDoorOptions) {
    this.binary = join(options.ptyzzz, "target", "release", "ptyZZZ");
    if (!existsSync(this.binary)) throw new Error(`--door: no ptyZZZ at ${this.binary} (cargo build --release in ${options.ptyzzz})`);
    this.log = options.log ?? (() => {});
  }

  /** One request below `<base>/door`; `path` is what follows the base path, `base` the base path itself. */
  async handle(request: Request, path: string, base: string): Promise<Response> {
    const url = new URL(request.url);
    if (!sameOrigin(request)) return text("Cross-site requests are refused\n", 403);
    if (request.method === "GET" && (path === "/door" || path === "/door/")) {
      const open = url.searchParams.get("open") ?? "";
      return page(base, BLOCK_ID.test(open) ? open : undefined);
    }
    if (request.method === "GET" && path === "/door/door.js") return asset(PAGE_SCRIPT, "text/javascript; charset=utf-8");
    if (request.method === "GET" && path === "/door/client.js") return asset(CLIENT_SCRIPT, "text/javascript; charset=utf-8");
    if (request.method === "GET" && path.startsWith("/door/fonts/")) {
      const name = path.slice("/door/fonts/".length);
      if (!/^[A-Za-z0-9-]+\.woff2$/.test(name)) return text("Not found\n", 404);
      const file = Bun.file(join(this.options.ptyzzz, "static", "fonts", name));
      if (!(await file.exists())) return text("Not found\n", 404);
      return new Response(file, { headers: { "content-type": "font/woff2", "cache-control": "max-age=86400", "x-content-type-options": "nosniff" } });
    }
    if (request.method === "GET" && path === "/door/stats") return json(this.stats());
    const id = url.searchParams.get("t") ?? "";
    if (!TERMINAL_ID.test(id)) return text("Not found\n", 404);
    if (request.method === "GET" && path === "/door/stream") {
      const open = url.searchParams.get("open") ?? "";
      const size = { cols: clamp(Number(url.searchParams.get("cols")), 20, 400, 80), rows: clamp(Number(url.searchParams.get("rows")), 5, 200, 24) };
      const term = this.terminals.get(id) ?? this.start(id, BLOCK_ID.test(open) ? open : undefined, size);
      if (!term) return text(`Too many door terminals open (${this.options.max ?? 4}); close one\n`, 503);
      return this.stream(term, request.signal);
    }
    if (request.method === "POST" && path === "/door/input") {
      const term = this.terminals.get(id);
      if (!term) return text("No such terminal\n", 404);
      const body = await request.text();
      // Only whole JSON objects pass, one per line: nothing else reaches ptyZZZ's stdin.
      const lines = body.split("\n").filter(line => line.trim()).filter(line => { try { return typeof JSON.parse(line)?.t === "string"; } catch { return false; } });
      if (!lines.length) return new Response(null, { status: 204 });
      const out = `${lines.join("\n")}\n`;
      term.stats.inputs += lines.length;
      term.stats.bytesIn += out.length;
      term.proc.stdin.write(out);
      term.proc.stdin.flush();
      return new Response(null, { status: 204 });
    }
    return text("Not found\n", 404);
  }

  /** Every terminal's frames and bytes so far. */
  stats() {
    const now = Date.now();
    return [...this.terminals.values()].map(t => ({ id: t.id.slice(0, 6), pid: t.proc.pid, seconds: Math.round((now - t.started) / 1000), watchers: t.watchers.size, ...t.stats }));
  }

  async stop(): Promise<void> {
    await Promise.all([...this.terminals.values()].map(t => this.end(t)));
  }

  private start(id: string, open: string | undefined, size: { cols: number; rows: number }): Terminal | null {
    if (this.terminals.size >= (this.options.max ?? 4)) return null;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.options.env ?? process.env)) if (v !== undefined && !DROPPED.includes(k)) env[k] = v;
    Object.assign(env, { TERM: "xterm-256color", COLORTERM: "truecolor", EP0CH_KITTY: "0", EP0CH_SIZED: "0" });
    const proc = Bun.spawn([this.binary, "run", "--die-with-parent", "--target", "grid-door", "--scrollback", "0", "--cols", String(size.cols), "--rows", String(size.rows), "--", ...this.options.command(open)], {
      stdin: "pipe", stdout: "pipe", stderr: "ignore", env,
    });
    const term: Terminal = { id, proc, keyframe: null, watchers: new Set(), idleTimer: null, started: Date.now(), stats: { keyframes: 0, diffs: 0, bytesOut: 0, inputs: 0, bytesIn: 0 } };
    this.terminals.set(id, term);
    this.log(`door: terminal ${id.slice(0, 6)} started (pid ${proc.pid}${open ? `, opening ${open}` : ""})`);
    void this.read(term);
    void proc.exited.then(code => {
      this.terminals.delete(id);
      for (const w of term.watchers) w(JSON.stringify({ t: "exit", code }));
      this.log(`door: terminal ${id.slice(0, 6)} ended (${code})`);
    });
    return term;
  }

  private async read(term: Terminal): Promise<void> {
    const decoder = new TextDecoder();
    let buffered = "";
    for await (const chunk of term.proc.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      let at: number;
      while ((at = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, at);
        buffered = buffered.slice(at + 1);
        if (!line) continue;
        if (line.endsWith('"t":"screen"}')) { term.keyframe = line; term.stats.keyframes++; }
        else term.stats.diffs++;
        term.stats.bytesOut += Buffer.byteLength(line) * term.watchers.size;
        for (const w of term.watchers) w(line);
      }
    }
  }

  private stream(term: Terminal, signal: AbortSignal): Response {
    let send: ((line: string) => void) | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    const done = () => {
      if (send) term.watchers.delete(send);
      if (keepalive) clearInterval(keepalive);
      send = null;
      if (!term.watchers.size && this.terminals.has(term.id)) {
        term.idleTimer = setTimeout(() => void this.end(term), this.options.graceMs ?? 15_000);
      }
    };
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        if (term.idleTimer) { clearTimeout(term.idleTimer); term.idleTimer = null; }
        send = line => { try { controller.enqueue(encoder.encode(`data: ${line}\n\n`)); } catch { done(); } };
        term.watchers.add(send);
        // Where a joiner starts: the last keyframe now, and a fresh one within one coalesce window (PROTOCOL.md `screen`).
        if (term.keyframe) controller.enqueue(encoder.encode(`data: ${term.keyframe}\n\n`));
        term.proc.stdin.write('{"t":"screen"}\n');
        term.proc.stdin.flush();
        // Under the listener's 30 s idle timeout.
        keepalive = setInterval(() => { try { controller.enqueue(encoder.encode(": k\n\n")); } catch { done(); } }, 10_000);
        signal.addEventListener("abort", () => { done(); try { controller.close(); } catch {} });
      },
      cancel: done,
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", "x-content-type-options": "nosniff" } });
  }

  private async end(term: Terminal): Promise<void> {
    if (!this.terminals.has(term.id) || term.watchers.size) return;
    // stdin's end is ptyZZZ's signal to end its pty's program (--on-stdin-eof exit); the door client detaches.
    try { term.proc.stdin.end(); } catch {}
    const ended = await Promise.race([term.proc.exited.then(() => true), Bun.sleep(3000).then(() => false)]);
    if (!ended) term.proc.kill();
  }
}

/** A request from the page's own origin: a browser says so in Sec-Fetch-Site, or in Origin for a POST. */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host); } catch { return false; }
  }
  return request.method === "GET" || !!site;
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, Math.floor(n))) : fallback;
}

const COMMON = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const text = (body: string, status: number) => new Response(body, { status, headers: { ...COMMON, "content-type": "text/plain; charset=utf-8" } });
const json = (value: unknown) => new Response(`${JSON.stringify(value, null, 2)}\n`, { headers: { ...COMMON, "content-type": "application/json; charset=utf-8" } });
const asset = (body: string, type: string) => new Response(body, { headers: { ...COMMON, "content-type": type } });

/** The page runs only its own scripts from this origin; ptyZZZ's rows carry inline styles (colours), so styles may be inline. */
const DOOR_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function page(base: string, open: string | undefined): Response {
  const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content">
<meta name="color-scheme" content="dark"><title>ep0ch door</title>
<style>${PAGE_STYLE.replaceAll("__BASE__", attr(base))}</style>
<script type="module" src="${attr(`${base}/door/door.js`)}"></script></head>
<body data-base="${attr(base)}"${open ? ` data-open="${attr(open)}"` : ""}>
<div id="term" class="pane" data-pane="door"><div class="scroll"><div id="grid-door">connecting…</div></div></div>
<div id="bar" role="toolbar" aria-label="keys">
<button data-key="Escape">esc</button><button data-key="Tab">tab</button><button data-mod="4" aria-pressed="false">ctrl</button><button data-mod="2" aria-pressed="false">alt</button>
<button data-key="ArrowLeft" aria-label="left">←</button><button data-key="ArrowUp" aria-label="up">↑</button><button data-key="ArrowDown" aria-label="down">↓</button><button data-key="ArrowRight" aria-label="right">→</button>
<button data-key="k" data-mods="4">^K</button><button data-key="s" data-mods="4">^S</button><button data-key="w" data-mods="4">^W</button><button data-key="n" data-mods="4">^N</button>
<button data-font="-1" aria-label="smaller">A−</button><button data-font="1" aria-label="bigger">A+</button><button data-kbd aria-label="keyboard">⌨</button>
<span id="status"></span></div>
</body></html>
`;
  return new Response(html, { headers: { ...COMMON, "content-type": "text/html; charset=utf-8", "content-security-policy": DOOR_CSP } });
}

// The terminal's palette is the door's own dark one; never a white flash: the page is dark before anything loads. The
// toolbar shows on a desktop too, smaller: a browser keeps ctrl+w, ctrl+n and ctrl+t for itself, whatever the page asks.
const PAGE_STYLE = `
@font-face{font-family:"DoorMono";font-weight:normal;font-display:swap;src:url("__BASE__/door/fonts/AdwaitaMonoNerdFontMono-Regular.woff2") format("woff2")}
@font-face{font-family:"DoorMono";font-weight:bold;font-display:swap;src:url("__BASE__/door/fonts/AdwaitaMonoNerdFontMono-Bold.woff2") format("woff2")}
:root{--fs:14px;--term-font:"DoorMono",ui-monospace,monospace;--term-bg:#0c0c0c;--term-fg:#c8c8c0;
--c0:#000;--c1:#aa0000;--c2:#00aa00;--c3:#aa5500;--c4:#0000aa;--c5:#aa00aa;--c6:#00aaaa;--c7:#aaaaaa;
--c8:#555;--c9:#ff5555;--c10:#55ff55;--c11:#ffff55;--c12:#5555ff;--c13:#ff55ff;--c14:#55ffff;--c15:#fff}
html,body{margin:0;height:100%;background:var(--term-bg);color:var(--term-fg);overflow:hidden}
body{display:flex;flex-direction:column;height:100dvh;font:var(--fs)/1.2 var(--term-font)}
#term{flex:1;min-height:0;position:relative}
.scroll{position:absolute;inset:0;overflow:hidden}
#grid-door{white-space:pre;position:relative;padding:0;font-variant-ligatures:none}
.row{height:1.2em}
.cursor{position:absolute;top:calc(var(--cursor-row)*1.2em);left:calc(var(--cursor-col)*1ch);width:1ch;height:1.2em;pointer-events:none;
background:var(--term-fg);mix-blend-mode:difference;opacity:.8}
.cursor[data-hidden="true"]{display:none}
#grid-door a{color:inherit}
.wc{display:inline-block;width:calc(var(--w)*1ch)}
.sb{font-weight:bold}.sd{opacity:.6}.si{font-style:italic}.su{text-decoration:underline}.sx{visibility:hidden}.ss{text-decoration:line-through}
.f0{color:var(--c0)}.f1{color:var(--c1)}.f2{color:var(--c2)}.f3{color:var(--c3)}.f4{color:var(--c4)}.f5{color:var(--c5)}.f6{color:var(--c6)}.f7{color:var(--c7)}
.f8{color:var(--c8)}.f9{color:var(--c9)}.f10{color:var(--c10)}.f11{color:var(--c11)}.f12{color:var(--c12)}.f13{color:var(--c13)}.f14{color:var(--c14)}.f15{color:var(--c15)}
.b0{background:var(--c0)}.b1{background:var(--c1)}.b2{background:var(--c2)}.b3{background:var(--c3)}.b4{background:var(--c4)}.b5{background:var(--c5)}.b6{background:var(--c6)}.b7{background:var(--c7)}
.b8{background:var(--c8)}.b9{background:var(--c9)}.b10{background:var(--c10)}.b11{background:var(--c11)}.b12{background:var(--c12)}.b13{background:var(--c13)}.b14{background:var(--c14)}.b15{background:var(--c15)}
#bar{flex:none;display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:#161614;border-top:1px solid #2a2a26;font:13px/1 ui-sans-serif,system-ui,sans-serif}
#bar button{min-width:40px;min-height:36px;border-radius:6px;border:1px solid #33332e;background:#1f1f1c;color:#c8c8c0;font:inherit;touch-action:manipulation}
#bar button[aria-pressed="true"]{background:#3a3a20;border-color:#77773a}
#status{align-self:center;color:#77776e;margin-left:auto;padding:0 6px}
@media (pointer:fine){#bar button{min-height:26px;min-width:32px}}
`;
