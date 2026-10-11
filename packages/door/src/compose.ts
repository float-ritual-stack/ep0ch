// The composer alone (spike, Oct 11): `ep0ch compose --ws <outline> --on <block> [--quote <words>] [--reply <thread>]`
// is a door that draws only the comment composer, full-frame in a small terminal: the web page's comment box is a
// terminal running it (the publisher's `/door/compose`). It is the door's own composer, not a second editor: one
// NoteSurface on the note (src/surface/note.ts), its comment session opened straight to writing (`composeAlone`) and
// drawn alone (SurfaceHost.composerAlone), its keys, clicks and actions the reader's own (comment.send, draft.*), so
// `act` reaches it as it reaches any reader.
//
// It is a door in its own terminal (no session to attach to) with a state dir of its own (EP0CH_COMPOSE_STATE, else
// <tmp>/ep0ch-compose-<uid>), never the person's door's: its control socket, its put-aside comments. Exit codes: 0
// sent, 3 closed without sending (esc on nothing typed, or esc twice: put aside, and opening the same passage again
// brings it back), 2 refused before it opened (no such note, the words aren't in it, no such thread: said on screen
// until a key). A closed tab is a hangup: the text is put aside as esc twice does (App.terminate).
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { Ctx, Frame, Screen } from "./app";
import type { CommentSession } from "./comment";
import { NOTE_ACTIONS, NoteSurface, type SurfaceHost } from "./surface/note";
import { Dispatcher, type TileRef } from "./surface/dispatch";
import { C, fg, pad, RESET } from "./style";
import { wrap } from "./text";
import type { Key } from "./term";
import type { OutlineEvent } from "./socket";

export const COMPOSE_USAGE = `  ep0ch compose --ws <name> --on <block id> [--quote <words> [--near <offset>] | --reply <thread id>]
                                   the comment composer alone, full-frame: a comment on the note's exact
                                   words (--quote; --near picks among repeats; none: its first line), or a
                                   reply to a thread. ctrl+s sends it as you and exits 0; esc (twice on typed
                                   text: put aside, and the same passage brings it back) exits 3. A door of its
                                   own with its own state (EP0CH_COMPOSE_STATE, else <tmp>/ep0ch-compose-<uid>):
                                   the web page's comment box runs it`;

export interface ComposeOn { ws: string; machine?: string; on: string; quote?: string; near?: number; reply?: string }

/** `compose`'s flags; the outline as for every command (--ws, else EP0CH_WS). */
export function parseCompose(args: readonly string[], env: Record<string, string | undefined> = process.env): ComposeOn | { error: string } {
  const out: Partial<ComposeOn> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!, v = args[i + 1];
    const take = (k: "ws" | "machine" | "on" | "quote" | "reply") => {
      if (v === undefined) return `${a} needs a value`;
      out[k] = v; i++;
      return null;
    };
    let why: string | null;
    if (a === "--ws") why = take("ws");
    else if (a === "--machine") why = take("machine");
    else if (a === "--on") why = take("on");
    else if (a === "--quote") why = take("quote");
    else if (a === "--reply") why = take("reply");
    else if (a === "--near") { const n = Number(v); if (v === undefined || !Number.isInteger(n) || n < 0) why = "--near is an offset in the note's text (0 or more)"; else { out.near = n; i++; why = null; } }
    else why = `compose doesn't take ${a}`;
    if (why) return { error: `${why} · ${COMPOSE_USAGE.trim().split("\n")[0]}` };
  }
  out.ws ??= env.EP0CH_WS?.trim() || undefined;
  if (!out.ws) return { error: "compose names its outline: --ws <name> (or EP0CH_WS)" };
  if (!out.on) return { error: "compose needs the note: --on <block id>" };
  if (out.quote !== undefined && out.reply !== undefined) return { error: "--quote comments on words, --reply answers a thread: one of them" };
  return out as ComposeOn;
}

/** The composer's own state dir: kept between runs (a put-aside comment comes back), never the person's door's. */
export const composeState = (env: Record<string, string | undefined> = process.env): string =>
  env.EP0CH_COMPOSE_STATE?.trim() || join(tmpdir(), `ep0ch-compose-${userInfo().uid}`);

/** How the composer ended: the door's exit code (src/main.ts). */
let exitCode = 3;
export const composeExit = () => exitCode;

/** The reader's one tile here, as `act tile=` names it. */
const TILE = "composer";

export class Composer implements Screen {
  readonly title = "compose";
  readonly name = "compose";
  readonly noDrawer = true;
  readonly bare = true;
  readonly surface = new NoteSurface();
  private ctx: Ctx | null = null;
  /** The comment session this composer opened; when it ends, so does the door. */
  private session: CommentSession | null = null;
  /** Why it couldn't open: said full-frame until a key. */
  private refused: string | null = null;
  private ending = false;

  constructor(private readonly on: ComposeOn) {}

  host(ctx: Ctx): SurfaceHost {
    return {
      ctx, composerAlone: true,
      redraw: () => ctx.redraw(),
      // Nothing opens from here: the composer is all there is.
      navigate: () => {},
      press: (name, args, quiet, given) => this.dispatch.pressIn(NOTE_ACTIONS, name, args, TILE, quiet, given),
    };
  }

  enter(ctx: Ctx) { this.ctx = ctx; void this.open(ctx); }

  private async open(ctx: Ctx) {
    const host = this.host(ctx);
    try {
      const m = await ctx.board.get(this.on.on);
      if (!m) throw new Error(`no note ${this.on.on} in ${ctx.outline ?? "this outline"}`);
      this.surface.show(m, host);
      this.session = await this.surface.composeAlone(host, this.on);
    } catch (e) {
      this.refused = e instanceof Error ? e.message : String(e);
      exitCode = 2;
    }
    ctx.redraw();
  }

  /** Sent (and settled), or closed: the door ends with it. */
  private settle(ctx: Ctx) {
    const s = this.session;
    if (!s || this.ending) return;
    // Sent: once the thread is read back (the session may close first); else only once it's closed.
    const open = this.surface.session === s;
    if (s.finished ? s.busy && open : open) return;
    this.ending = true;
    exitCode = s.finished ? 0 : 3;
    setTimeout(() => ctx.quit(), 0);
  }

  render(ctx: Ctx): Frame {
    this.ctx = ctx;
    const w = ctx.t.cols, h = ctx.t.rows;
    this.settle(ctx);
    if (this.refused || !this.session) {
      const said = this.refused
        ? [fg(C.lred) + "! can't write this comment" + RESET, ...wrap(this.refused, w - 2).map(l => fg(C.yellow) + l + RESET), "", fg(C.dark) + "any key closes" + RESET]
        : [fg(C.dark) + "opening the composer…" + RESET];
      return { lines: said.map(l => pad(l, w)) };
    }
    return { lines: this.surface.render(w, h, this.host(ctx)).lines };
  }

  key(k: Key, ctx: Ctx) {
    this.ctx = ctx;
    if (this.refused) { if (k.kind !== "mouse") { this.ending = true; ctx.quit(); } return; }
    if (!this.session) return;
    const host = this.host(ctx);
    if (k.kind === "mouse") {
      if (k.action === "wheel-up" || k.action === "wheel-down") this.surface.wheel(k.action === "wheel-down" ? 1 : -1, host);
      else if (k.action === "down") this.surface.press(k.x, k.y, host, !!((k.mods ?? 0) & 4));
      else if (k.action === "drag") this.surface.drag(k.x, k.y, host);
      else if (k.action === "up") this.surface.release(k.x, k.y, host);
    } else this.surface.key(k, host);
    this.settle(ctx);
    ctx.redraw();
  }

  onEvent(e: OutlineEvent, ctx: Ctx) {
    const host = this.host(ctx);
    this.surface.onEvent(host);
    if (e.action === "reconnected") this.surface.retry(host);
  }

  unsaved() { return this.surface.unsaved(); }
  keepDrafts() { return this.surface.keepDrafts(); }
  dispose() { this.surface.dispose(); }
  holdsKeys() { return true; }
  keys() { return { focus: TILE, typingIn: TILE, busy: true, why: "the person is writing a comment in the composer" }; }
  describe() { return { kind: "composer", on: this.on, refused: this.refused, ...this.surface.describe() }; }

  private tile(): TileRef {
    const m = this.surface.msg;
    return { name: TILE, kind: "reader", shows: m?.id ?? null, editing: this.surface.editing, holds: a => this.surface.heldBy(a) };
  }

  /** Its one reader's note actions, as any reader's: the keys, the clicks and `act` run them. */
  readonly dispatch: Dispatcher = new Dispatcher({
    title: "composer", ctx: () => this.ctx, keys: () => this.keys(), tiles: () => [this.tile()],
    draftOf: () => ({ board: this.ctx?.board, blockId: this.surface.msg?.id ?? null, session: this.surface.draftSession() }),
  }, [{
    set: NOTE_ACTIONS, takes: "tile", noun: "the composer",
    on: (_, how) => {
      if (!this.ctx) throw new Error("the composer isn't shown yet");
      return { surface: this.surface, host: (how.given as SurfaceHost | undefined) ?? this.host(this.ctx) };
    },
    run: (name, args, on, actor, typed) => this.surface.run(name, args, on.host, actor, typed),
  }]);
}
