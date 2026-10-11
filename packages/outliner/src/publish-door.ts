// The door in the browser (spike, Oct 11): the real ep0ch door, its editor, completer, composer, callouts and figures,
// in a tailnet page, with no second implementation. Each page is one more terminal attached to the outline's door
// session (PIE-418: one session per outline, many terminals), the same session the person reaches over ssh. The
// terminal is ptyZZZ (github.com/e-schultz/ptyZZZ, a fork of cablehead/ptyZZZ): a pty plus wezterm-term on this side,
// semantic key, paste, mouse and resize events in as JSONL, screen keyframes and row diffs out as HTML. The publisher
// spawns it per page, streams its frames to the page over SSE and passes the page's events to its stdin.
//
// It is a terminal, effectively shell-adjacent (the door's drop shell is a key away), so it is served where the person
// already is: the tailnet listener, and the signed-in origin (my.ep0ch.sh) for a live web session, whose gate has
// checked the session and, for a POST, the Origin. Never the public listener, never below a share link. Requests must
// come from the page's own origin (Sec-Fetch-Site / Origin), and only a terminal id the page itself was given starts
// one, and only for whoever it was given to (the tailnet, or that one web session). A web session that ends (signed
// out, revoked, expired, its person off the list) types nothing more, and its streams and terminals end within
// STILL_SIGNED_IN_MS.
//
// The door is told it's in a terminal without Kitty graphics or text sizing through the variables its Display already
// reads (EP0CH_KITTY=0, EP0CH_SIZED=0): figures draw as cells, titles at one height.
//
//   <base>/door?open=<block id>   the page: a full-viewport terminal opening that note in the door's detail screen
//   <base>/door/compose?on=<block id>&quote=<words>[&near=<offset>] | &reply=<thread id>
//                                 the comment composer alone (`ep0ch compose`, spike Oct 11): a small terminal a note's
//                                 page frames as its comment box; when it ends, the page is told its exit code
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
/** A block id: never one that starts with `-`, which the door would read as a flag. */
const BLOCK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** One input POST at most (a big paste); more is refused, never queued. */
const MAX_INPUT = 1 << 20;

export interface WebDoorOptions {
  /** The ptyZZZ checkout: its binary at target/release/ptyZZZ, its font at static/fonts/. */
  ptyzzz: string;
  /** What runs in a page's pty: the door attached to the outline's session, opening `open` when given. */
  command: (open: string | undefined) => string[];
  /** What runs in a composer page's pty (`ep0ch compose`): absent, there's no `/door/compose`. */
  compose?: (on: ComposeOn) => string[];
  /** The environment it runs in (default: this process's). */
  env?: Record<string, string | undefined>;
  /** At most this many terminals at once (default 4). */
  max?: number;
  /** A terminal nobody watches ends after this long (default 15 s: a reload reattaches to it). */
  graceMs?: number;
  /** How often a signed-in stream asks whether its web session is still live (default 30 s). */
  recheckMs?: number;
  log?: (line: string) => void;
}

interface Terminal {
  id: string;
  /** Who it was issued to (DoorCaller.owner): nobody else streams or types into it. */
  owner: string;
  proc: Bun.Subprocess<"pipe", "pipe", "ignore">;
  /** The last keyframe line, for a stream that (re)connects. */
  keyframe: string | null;
  watchers: Set<Watcher>;
  /** Ending: no stream attaches to it any more. */
  closing: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  started: number;
  stats: { keyframes: number; diffs: number; bytesOut: number; inputs: number; bytesIn: number };
}

/** One page's stream: a frame to it, and its end. */
interface Watcher { send(line: string): void; close(): void }

/** A stream that has this much unsent is too slow: it's ended, and the page reconnects to a fresh keyframe. */
const MAX_QUEUED = 4 << 20;
/** Streams on one terminal (a page reconnecting, a second tab of the same page). */
const MAX_WATCHERS = 4;
/** A terminal id the page was given is good for this long before its stream starts it. */
const ISSUED_MS = 60_000;
/** How often a signed-in stream asks whether its web session is still live. */
const STILL_SIGNED_IN_MS = 30_000;

/**
 * Who a request comes from: the tailnet, or one web session at the signed-in origin, with how to ask whether that
 * session is still live (a stream outlasts the request its gate checked).
 */
/** What a composer page writes: a comment on a note's exact words (nearest `near`), or a reply to a thread. */
export interface ComposeOn { on: string; quote?: string; near?: number; reply?: string }
/** The longest quote a composer page takes (a page's selection is capped at 2,000 characters too). */
const MAX_QUOTE = 2000;

export interface DoorCaller {
  owner: string;
  stillSignedIn?: () => Promise<boolean>;
}
export const TAILNET_CALLER: DoorCaller = { owner: "tailnet" };

export class WebDoor {
  private readonly terminals = new Map<string, Terminal>();
  /**
   * Terminal ids handed to pages, not yet started, with whom and what they run: only these can start one (another site
   * can't read a page's), and only what the page was given for.
   */
  private readonly issued = new Map<string, { at: number; owner: string; argv: string[] }>();
  private readonly binary: string;
  private readonly log: (line: string) => void;

  constructor(private readonly options: WebDoorOptions) {
    this.binary = join(options.ptyzzz, "target", "release", "ptyZZZ");
    if (!existsSync(this.binary)) throw new Error(`--door: no ptyZZZ at ${this.binary} (cargo build --release in ${options.ptyzzz})`);
    this.log = options.log ?? (() => {});
  }

  /** One request below `<base>/door`; `path` is what follows the base path, `base` the base path itself. */
  async handle(request: Request, path: string, base: string, caller: DoorCaller = TAILNET_CALLER): Promise<Response> {
    const url = new URL(request.url);
    if (!sameOrigin(request)) return text("Cross-site requests are refused\n", 403);
    if (request.method === "GET" && (path === "/door" || path === "/door/")) {
      const open = url.searchParams.get("open") ?? "";
      const at = BLOCK_ID.test(open) ? open : undefined;
      return page(base, this.issue(caller.owner, this.options.command(at)), at);
    }
    if (request.method === "GET" && (path === "/door/compose" || path === "/door/compose/") && this.options.compose) {
      const on = composeOn(url.searchParams);
      if ("error" in on) return text(`${on.error}\n`, 400);
      return page(base, this.issue(caller.owner, this.options.compose(on)), undefined, true);
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
      const size = { cols: clamp(Number(url.searchParams.get("cols")), 20, 400, 80), rows: clamp(Number(url.searchParams.get("rows")), 5, 200, 24) };
      const running = this.terminals.get(id);
      if (running && running.owner !== caller.owner) return text("No such terminal; reload the page\n", 404);
      if (running?.closing) return text("That terminal ended; reload the page\n", 404);
      if (running && running.watchers.size >= MAX_WATCHERS) return text("Too many streams on that terminal\n", 503);
      const argv = running ? null : this.claim(id, caller.owner);
      if (!running && !argv) return text("No such terminal; reload the page\n", 404);
      const term = running ?? this.start(id, caller.owner, argv!, size);
      if (!term) return text(`Too many door terminals open (${this.options.max ?? 4}); close one\n`, 503);
      return this.stream(term, request.signal, caller.stillSignedIn);
    }
    if (request.method === "POST" && path === "/door/input") {
      const term = this.terminals.get(id);
      if (!term || term.closing || term.owner !== caller.owner) return text("No such terminal\n", 404);
      if (Number(request.headers.get("content-length") ?? 0) > MAX_INPUT) return text("Too much input at once\n", 413);
      const body = await request.text();
      if (body.length > MAX_INPUT) return text("Too much input at once\n", 413);
      // The gate checked the session when the request began; a slow body can outlast it, so ask again before typing.
      if (caller.stillSignedIn && !(await caller.stillSignedIn().catch(() => false))) {
        void this.end(term, true);
        return text("Signed out\n", 401);
      }
      if (term.closing || this.terminals.get(id) !== term) return text("No such terminal\n", 404);
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

  /** Whether it serves the composer alone (`/door/compose`), a note page's comment box. */
  get composes(): boolean { return !!this.options.compose; }

  /** Every terminal's frames and bytes so far. */
  stats() {
    const now = Date.now();
    return [...this.terminals.values()].map(t => ({ id: t.id.slice(0, 6), pid: t.proc.pid, seconds: Math.round((now - t.started) / 1000), watchers: t.watchers.size, ...t.stats }));
  }

  /** Every terminal ended, its streams with it. */
  async stop(): Promise<void> {
    await Promise.all([...this.terminals.values()].map(t => this.end(t, true)));
  }

  /** A fresh terminal id for a page, remembered (with whom it went to and what it runs) until its stream starts the terminal. */
  private issue(owner: string, argv: string[]): string {
    const now = Date.now();
    for (const [id, { at }] of this.issued) if (now - at > ISSUED_MS) this.issued.delete(id);
    if (this.issued.size >= 64) this.issued.delete(this.issued.keys().next().value!);
    const id = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
    this.issued.set(id, { at: now, owner, argv });
    return id;
  }

  /** An issued id, used up: only by whom it was issued to, within ISSUED_MS. What it runs, or null. */
  private claim(id: string, owner: string): string[] | null {
    const issued = this.issued.get(id);
    if (!issued || issued.owner !== owner || Date.now() - issued.at > ISSUED_MS) return null;
    this.issued.delete(id);
    return issued.argv;
  }

  private start(id: string, owner: string, argv: string[], size: { cols: number; rows: number }): Terminal | null {
    if (this.terminals.size >= (this.options.max ?? 4)) return null;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.options.env ?? process.env)) if (v !== undefined && !DROPPED.includes(k)) env[k] = v;
    Object.assign(env, { TERM: "xterm-256color", COLORTERM: "truecolor", EP0CH_KITTY: "0", EP0CH_SIZED: "0" });
    const proc = Bun.spawn([this.binary, "run", "--die-with-parent", "--target", "grid-door", "--scrollback", "0", "--cols", String(size.cols), "--rows", String(size.rows), "--", ...argv], {
      stdin: "pipe", stdout: "pipe", stderr: "ignore", env,
    });
    const term: Terminal = { id, owner, proc, keyframe: null, watchers: new Set(), closing: false, idleTimer: null, started: Date.now(), stats: { keyframes: 0, diffs: 0, bytesOut: 0, inputs: 0, bytesIn: 0 } };
    this.terminals.set(id, term);
    this.log(`door: terminal ${id.slice(0, 6)} started (pid ${proc.pid}: ${argv.slice(2).join(" ").slice(0, 80)})`);
    void this.read(term);
    void proc.exited.then(code => {
      this.terminals.delete(id);
      term.closing = true;
      if (term.idleTimer) clearTimeout(term.idleTimer);
      for (const w of [...term.watchers]) { w.send(JSON.stringify({ t: "exit", code })); w.close(); }
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
        for (const w of [...term.watchers]) w.send(line);
      }
    }
  }

  private stream(term: Terminal, signal: AbortSignal, stillSignedIn?: () => Promise<boolean>): Response {
    const encoder = new TextEncoder();
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let recheck: ReturnType<typeof setInterval> | null = null;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const watcher: Watcher = {
      send: line => {
        // A page that reads slower than the door draws is let go; it reconnects and starts from a keyframe.
        if ((controller.desiredSize ?? 0) < -MAX_QUEUED) { watcher.close(); return; }
        try { controller.enqueue(encoder.encode(`data: ${line}\n\n`)); } catch { watcher.close(); }
      },
      close: () => {
        if (!term.watchers.delete(watcher)) return;
        if (keepalive) clearInterval(keepalive);
        if (recheck) clearInterval(recheck);
        try { controller.close(); } catch {}
        if (!term.watchers.size && !term.closing) {
          term.idleTimer = setTimeout(() => void this.end(term), this.options.graceMs ?? 15_000);
        }
      },
    };
    const body = new ReadableStream<Uint8Array>({
      start: c => {
        controller = c;
        if (term.idleTimer) { clearTimeout(term.idleTimer); term.idleTimer = null; }
        term.watchers.add(watcher);
        // Where a joiner starts: the last keyframe now, and a fresh one within one coalesce window (PROTOCOL.md `screen`).
        if (term.keyframe) watcher.send(term.keyframe);
        term.proc.stdin.write('{"t":"screen"}\n');
        term.proc.stdin.flush();
        // Under the listener's 30 s idle timeout.
        keepalive = setInterval(() => { try { controller.enqueue(encoder.encode(": k\n\n")); } catch { watcher.close(); } }, 10_000);
        // A signed-in page's stream lasts while its web session does: signed out or revoked, its frames stop.
        if (stillSignedIn) {
          // Its terminal ends with it, at once: no grace for a reload that would be refused.
          recheck = setInterval(() => void stillSignedIn().catch(() => false).then(live => { if (!live) void this.end(term, true); }), this.options.recheckMs ?? STILL_SIGNED_IN_MS);
        }
        signal.addEventListener("abort", () => watcher.close());
      },
      cancel: () => watcher.close(),
    }, new ByteLengthQueuingStrategy({ highWaterMark: 1 << 20 }));
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", "x-content-type-options": "nosniff" } });
  }

  /** End a terminal nobody watches (or, `force`, every stream on it too): its stdin closed, then killed if it stays. */
  private async end(term: Terminal, force = false): Promise<void> {
    if (term.closing || !this.terminals.has(term.id) || (term.watchers.size && !force)) return;
    term.closing = true;
    if (term.idleTimer) clearTimeout(term.idleTimer);
    for (const w of [...term.watchers]) w.close();
    // stdin's end is ptyZZZ's signal to end its pty's program (--on-stdin-eof exit); the door client detaches.
    try { term.proc.stdin.end(); } catch {}
    const ended = await Promise.race([term.proc.exited.then(() => true), Bun.sleep(3000).then(() => false)]);
    if (!ended) { term.proc.kill("SIGKILL"); await term.proc.exited; }
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

/** A composer page's query: the note, and its exact words (nearest `near`) or the thread replied to. */
export function composeOn(q: URLSearchParams): ComposeOn | { error: string } {
  const on = q.get("on") ?? "", reply = q.get("reply"), quote = q.get("quote"), near = q.get("near");
  if (!BLOCK_ID.test(on)) return { error: "on= names the note (its block id)" };
  if (reply !== null) {
    if (!BLOCK_ID.test(reply)) return { error: "reply= names the thread (its id)" };
    if (quote !== null) return { error: "quote= comments on words, reply= answers a thread: one of them" };
    return { on, reply };
  }
  if (quote !== null && (!quote.trim() || quote.length > MAX_QUOTE || quote.includes("\0"))) return { error: `quote= is the note's exact words, at most ${MAX_QUOTE} characters` };
  const n = near === null ? undefined : Number(near);
  if (n !== undefined && (!Number.isInteger(n) || n < 0)) return { error: "near= is an offset in the note's text" };
  return { on, ...(quote !== null ? { quote } : {}), ...(n !== undefined ? { near: n } : {}) };
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
/** A composer page is framed by a note's page on the same origin, and only there. */
const COMPOSE_CSP = DOOR_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");

function page(base: string, terminal: string, open: string | undefined, compose = false): Response {
  const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content">
<meta name="color-scheme" content="dark"><title>ep0ch door</title>
<style>${PAGE_STYLE.replaceAll("__BASE__", attr(base))}</style>
<script type="module" src="${attr(`${base}/door/door.js`)}"></script></head>
<body data-base="${attr(base)}" data-t="${attr(terminal)}"${open ? ` data-open="${attr(open)}"` : ""}${compose ? ` data-compose` : ""}>
<div id="term" class="pane" data-pane="door"><div class="scroll"><div id="grid-door">connecting…</div></div></div>
${compose ? COMPOSE_BAR : `<div id="bar" role="toolbar" aria-label="keys">
<button data-key="Escape">esc</button><button data-key="Tab">tab</button><button data-mod="4" aria-pressed="false">ctrl</button><button data-mod="2" aria-pressed="false">alt</button>
<button data-key="ArrowLeft" aria-label="left">←</button><button data-key="ArrowUp" aria-label="up">↑</button><button data-key="ArrowDown" aria-label="down">↓</button><button data-key="ArrowRight" aria-label="right">→</button>
<button data-key="k" data-mods="4">^K</button><button data-key="s" data-mods="4">^S</button><button data-key="w" data-mods="4">^W</button><button data-key="n" data-mods="4">^N</button>
<button data-font="-1" aria-label="smaller">A−</button><button data-font="1" aria-label="bigger">A+</button><button data-kbd aria-label="keyboard">⌨</button>
<span id="status"></span></div>`}
</body></html>
`;
  return new Response(html, { headers: { ...COMMON, "content-type": "text/html; charset=utf-8", "content-security-policy": compose ? COMPOSE_CSP : DOOR_CSP } });
}

/** A composer's keys a phone lacks: esc, tab, a sticky ctrl, ctrl+s (send); shown on a phone only (COMPOSE_STYLE). */
const COMPOSE_BAR = `<div id="bar" role="toolbar" aria-label="keys">
<button data-key="Escape">esc</button><button data-key="Tab">tab</button><button data-mod="4" aria-pressed="false">ctrl</button><button data-key="s" data-mods="4">^S send</button>
<button data-kbd aria-label="keyboard">⌨</button><span id="status"></span></div>`;

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
body[data-compose] #bar{padding:2px 4px}
@media (pointer:fine){body[data-compose] #bar button{display:none}}
`;
