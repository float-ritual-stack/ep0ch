import { parseAddressedBlock, parseEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { canonicalLocalMachineName, isLocalMachine } from "@ep0ch/outliner/machine-name";
import type { Ctx } from "../app";
import type { Msg } from "../board";
import { watchedOn } from "../watched";
import { outlineChanged } from "../refs";
import { forwardSaying, forwardTo } from "../machine";
import { readMissing } from "../outlines";
import { SocketBoard, type OutlineEvent } from "../socket";

export interface NoteAddress { outline: string; machine?: string }

/** Connections belong to the door, not to a tile that may move or close. */
export class OutlineBoards {
  private ready = new Map<string, Ctx>();
  private listeners = new Map<SocketBoard, Set<(event: OutlineEvent) => void>>();
  peek(address: NoteAddress): Ctx | undefined { return this.ready.get(`${address.outline}@${address.machine ?? ""}`); }
  watch(board: SocketBoard, hear: (event: OutlineEvent) => void): () => void {
    let listeners = this.listeners.get(board);
    if (!listeners) { listeners = new Set(); this.listeners.set(board, listeners); board.subscribe(e => { outlineChanged(e.change?.blockId ? [e.change.blockId] : null, e.action === "reset"); for (const f of this.listeners.get(board) ?? []) f(e); }); }
    listeners.add(hear);
    return () => { listeners.delete(hear); };
  }
  private offWatched: (() => void)[] = [];
  private info?: ReturnType<SocketBoard["info"]>;
  private boards = new Map<string, Promise<Ctx>>();
  constructor(private own: Ctx) {}
  home(): Ctx { return this.own; }
  async on(address: NoteAddress): Promise<Ctx> {
    const own = this.own;
    const info = await (this.info ??= own.board.info());
    const machine = address.machine ?? own.machine ?? info.machine ?? canonicalLocalMachineName();
    const sameHost = machine === (own.machine ?? info.machine ?? canonicalLocalMachineName()) || (!own.machine && isLocalMachine(machine));
    if (sameHost && address.outline === (own.outline ?? info.outline)) {
      this.ready.set(`${address.outline}@${address.machine ?? ""}`, own);
      this.ready.set(`${address.outline}@${machine}`, own);
      return own;
    }
    const key = `${address.outline}@${machine}`;
    let pending = this.boards.get(key);
    if (!pending) {
      pending = (async () => {
        const path = sameHost ? own.board.path : (await forwardTo(machine)).socket;
        const missing = await readMissing({ outline: address.outline, path, ...(!sameHost || own.machine ? { machine } : {}) });
        if (missing) throw new Error(missing);
        const board = new SocketBoard(path, undefined, address.outline);
        if (!sameHost) board.prepare = async () => forwardSaying(machine, await forwardTo(machine));
        try {
          const info = await board.info();
          const ctx = ctxOn(own, board, address.outline, machine, info.workspace);
          this.offWatched.push(watchedOn(board).listen(() => own.redraw()));
          this.ready.set(key, ctx);
          return ctx;
        } catch (e) { board.close(); throw e; }
      })();
      this.boards.set(key, pending);
      pending.catch(() => this.boards.delete(key));
    }
    const ctx = await pending;
    this.ready.set(`${address.outline}@${address.machine ?? ""}`, ctx);
    return ctx;
  }
  close() { for (const off of this.offWatched) off(); this.offWatched = []; for (const p of this.boards.values()) void p.then(ctx => ctx.board.close(), () => {}); this.boards.clear(); this.ready.clear(); this.listeners.clear(); }
}

const pools = new WeakMap<SocketBoard, OutlineBoards>();
export function outlineBoards(ctx: Ctx): OutlineBoards {
  let pool = pools.get(ctx.board);
  if (!pool) { pool = new OutlineBoards(ctx); pools.set(ctx.board, pool); }
  return pool;
}

/** EchoNet and desk readers share the same context, including the outline's workspace for file links. */
function ctxOn(ctx: Ctx, board: SocketBoard, outline: string, machine = ctx.machine, workspace = ctx.workspace): Ctx {
  if (ctx.board === board) return ctx;
  const made = new Proxy(ctx, {
    get(t, p) {
      if (p === "board") return board;
      if (p === "outline") return outline;
      if (p === "machine") return machine;
      if (p === "workspace") return workspace;
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  pools.set(board, outlineBoards(ctx));
  return made;
}

export async function readNote(ctx: Ctx, given: string, address?: NoteAddress): Promise<Msg | null> {
  const uri = given.startsWith("ep0ch://") ? parseEp0chBlockUri(given) : undefined;
  const parsed = uri ?? (given.startsWith("((") ? parseAddressedBlock(given) : { blockId: given });
  const at = uri ?? address;
  const on = at ? await outlineBoards(ctx).on(at) : ctx;
  const note = await on.board.get(parsed.blockId);
  if (note && at) note.address = { outline: at.outline, ...(on.machine ? { machine: on.machine } : {}) };
  return note;
}
