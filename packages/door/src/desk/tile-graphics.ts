// Kitty graphics from a program in a terminal tile (PIE-1555). A tile's program writes through the door's headless xterm,
// which drops the kitty graphics APC (ESC _ G … ESC \): so the tile's reader takes those commands out of the stream
// first, as it takes OSC 52 (Osc52Reader) and OSC 8. It answers them as the outer terminal would, keeps each image the
// program sent under the program's own id (so ids are the tile's, never the door's or another tile's), and anchors each
// placement to the line of the emulator's buffer it was made on (an xterm marker: it scrolls with the text and goes when
// the line leaves the scrollback). The tile's render hands them on as its view's placements, cut to the rows in view and
// to the tile; the desk places them through the door's one kitty layer (src/kitty.ts), so a picture goes when the tile
// scrolls, moves, folds or closes like any other. Only while the door draws kitty graphics; otherwise the commands are
// dropped unanswered (as xterm dropped them), and a program falls back to text.
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import { within, type Placement } from "../kitty";
import type { PngRef } from "../media";
import type { Rgba } from "../vga";

/** A piece of a program's output: text for the emulator, or one graphics command's body (between `ESC _ G` and `ESC \`). */
export type Piece = { text: string } | { apc: string };

const START = "\x1b_G", END = "\x1b\\";

/**
 * Takes kitty graphics commands out of a program's output (latin1 text, a byte a character), across reads: a command
 * cut in two by a read is held until its end comes. What's left goes to the emulator unchanged, in order.
 */
export class KittyApcReader {
  /** The start of a command whose end hasn't come yet, in pieces; or null when none is open. */
  private open: string[] | null = null;
  /** The end of the last read when it could be the start of `ESC _ G` or of `ESC \`. */
  private tail = "";

  reset() { this.open = null; this.tail = ""; }

  feed(chunk: string): Piece[] {
    const out: Piece[] = [];
    const s = this.tail + chunk;
    let p = 0;
    this.tail = "";
    let text = "";
    const flush = () => { if (text) { out.push({ text }); text = ""; } };
    while (p < s.length) {
      if (this.open) {
        const end = s.indexOf(END, p);
        if (end < 0) {
          // Its end may be cut in two: keep a last ESC back.
          const keep = s.endsWith("\x1b") ? 1 : 0;
          this.open.push(s.slice(p, s.length - keep));
          this.tail = s.slice(s.length - keep);
          flush();
          return out;
        }
        this.open.push(s.slice(p, end));
        flush();
        out.push({ apc: this.open.join("") });
        this.open = null;
        p = end + END.length;
        continue;
      }
      const at = s.indexOf(START, p);
      if (at < 0) {
        // The read may end on the first bytes of one.
        let keep = 0;
        for (let k = Math.min(START.length - 1, s.length - p); k > 0; k--) if (START.startsWith(s.slice(s.length - k))) { keep = k; break; }
        text += s.slice(p, s.length - keep);
        this.tail = s.slice(s.length - keep);
        break;
      }
      text += s.slice(p, at);
      this.open = [];
      p = at + START.length;
    }
    flush();
    return out;
  }
}

/** A graphics command's keys (`a=T,f=100,i=3`) and its payload. */
export function parseCommand(body: string): { kv: Record<string, string>; payload: string } {
  const semi = body.indexOf(";");
  const ctl = semi < 0 ? body : body.slice(0, semi), payload = semi < 0 ? "" : body.slice(semi + 1);
  const kv: Record<string, string> = {};
  for (const part of ctl.split(",")) { const eq = part.indexOf("="); if (eq > 0) kv[part.slice(0, eq)] = part.slice(eq + 1); }
  return { kv, payload };
}

/** An image the program sent: what the door places, and its size in pixels. */
interface Img { image: Rgba | PngRef; width: number; height: number }
/** Where the cursor was when a placement was made: its column, and a marker on its line that scrolls with the text. */
export interface Anchor { col: number; line: () => number; alive: () => boolean; dispose(): void }
/** A placement the program made, anchored where its cursor was. */
interface Placed { id: number; pid: number; at: Anchor; cols: number; rows: number; crop?: { x: number; y: number; w: number; h: number }; z: number; alt: boolean }

/** What the tile's graphics need of the tile when a command comes: its cell size, its size, and which screen is on. */
export interface TileGeometry { cellW: number; cellH: number; cols: number; rows: number; alt: boolean }

/** The bytes of a transmission, by its medium: `d` in the command, `f` a file, `t` a temp file (deleted), `s` shared memory. */
function bytesOf(kv: Record<string, string>, data: Buffer): Buffer {
  const medium = kv.t ?? "d";
  if (medium === "d") return data;
  const path = medium === "s" ? `/dev/shm/${data.toString("utf8").replace(/^\/+/, "")}` : data.toString("utf8");
  const all = readFileSync(path);
  // A temp file or shared memory is the terminal's to remove once read (the protocol says so); only where temp files live.
  if (medium === "s" || (medium === "t" && (path.startsWith(tmpdir()) || path.startsWith("/tmp/") || path.startsWith("/dev/shm/")) && path.includes("tty-graphics-protocol"))) rmSync(path, { force: true });
  const offset = Number(kv.O ?? 0), size = Number(kv.S ?? 0);
  return size ? all.subarray(offset, offset + size) : offset ? all.subarray(offset) : all;
}

/** An image from its bytes as `f` says: a PNG (100), 32-bit RGBA or 24-bit RGB (`s` × `v` pixels), maybe zlib'd (`o=z`). */
export function decodeImage(kv: Record<string, string>, raw: Buffer): Img {
  const bytes = kv.o === "z" ? inflateSync(raw) : raw;
  const f = kv.f ?? "32";
  if (f === "100") {
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error("EBADPNG:not a PNG");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    return { image: { png: Buffer.from(bytes), width, height, key: `tile-${createHash("sha1").update(bytes).digest("hex").slice(0, 20)}` }, width, height };
  }
  const width = Number(kv.s), height = Number(kv.v);
  if (!(width > 0 && height > 0)) throw new Error("EINVAL:no width and height (s, v)");
  const bpp = f === "24" ? 3 : 4;
  if (bytes.length < width * height * bpp) throw new Error("ENODATA:fewer pixels than its size");
  let data: Uint8Array;
  if (bpp === 4) data = new Uint8Array(bytes.subarray(0, width * height * 4));
  else {
    data = new Uint8Array(width * height * 4);
    for (let i = 0, o = 0; i < width * height * 3; i += 3, o += 4) { data[o] = bytes[i]!; data[o + 1] = bytes[i + 1]!; data[o + 2] = bytes[i + 2]!; data[o + 3] = 255; }
  }
  return { image: { width, height, data }, width, height };
}

/**
 * One terminal tile's kitty graphics: the images its program sent and where it placed them. `command` takes each
 * command as it comes out of the stream; `cursorMove` is what the emulator must be fed after a placement so the text
 * after it lands where a kitty terminal would put it; `placements` is what the tile shows of them.
 */
export class TileGraphics {
  private images = new Map<number, Img>();
  private placed: Placed[] = [];
  /** A transmission in chunks (`m=1`) still coming: its first command's keys and the payload so far. */
  private loading: { kv: Record<string, string>; parts: string[] } | null = null;
  private pidSeq = 0;
  /** Image ids the door gave to programs' `I=` (image numbers) asks. */
  private nextId = 1 << 24;

  /** How many images and placements it holds (for peek and tests). */
  get counts() { return { images: this.images.size, placements: this.placed.length }; }

  /**
   * Graphics command `body`. `reply` answers the program (an OK or an error, as the command's `q` allows; null: a
   * replay, answered before). Returns `place`, a placement to anchor where the emulator's cursor is once the text
   * before it has been read (the caller queues it, with which screen is on then), and `move`, the bytes the emulator
   * is fed after it so its cursor moves past it ("" when none).
   */
  command(body: string, geo: TileGeometry, reply: ((s: string) => void) | null): { place: ((at: Anchor, alt: boolean) => void) | null; move: string } {
    const none: { place: null; move: string } = { place: null, move: "" };
    let { kv, payload } = parseCommand(body);
    // A chunk of a transmission that's coming in pieces: only its first command says what it is.
    if (this.loading) {
      this.loading.parts.push(payload);
      if (kv.m === "1") return none;
      kv = { ...this.loading.kv, m: "0" };
      payload = this.loading.parts.join("");
      this.loading = null;
    } else if ((kv.a === "t" || kv.a === "T" || kv.a === undefined) && kv.m === "1") {
      this.loading = { kv, parts: [payload] };
      return none;
    }
    const action = kv.a ?? "t";
    const id = kv.i !== undefined ? Number(kv.i) : kv.I !== undefined ? this.nextId++ : 0;
    const quiet = Number(kv.q ?? 0);
    const answer = (msg: string) => {
      if (!reply || (!kv.i && !kv.I) || quiet >= 2 || (msg === "OK" && quiet >= 1)) return;
      reply(`\x1b_Gi=${kv.i ?? id}${kv.I ? `,I=${kv.I}` : ""}${kv.p ? `,p=${kv.p}` : ""};${msg}\x1b\\`);
    };
    const failed = (e: unknown) => { const m = String((e as Error).message ?? e); answer(/^[A-Z]+:/.test(m) ? m : `EINVAL:${m}`); return none; };
    if (action === "q") {
      // Can it take this image? Decoded, never kept: the answer is the support check programs ask first.
      try { if (payload) decodeImage(kv, bytesOf(kv, Buffer.from(payload, "base64"))); answer("OK"); } catch (e) { return failed(e); }
      return none;
    }
    if (action === "d") { this.delete(kv, geo); return none; }
    if (action === "t" || action === "T") {
      try { this.images.set(id, decodeImage(kv, bytesOf(kv, Buffer.from(payload, "base64")))); }
      catch (e) { return failed(e); }
      if (action === "t") { answer("OK"); return none; }
    }
    if (action === "p" || action === "T") {
      const img = this.images.get(id);
      if (!img) { answer("ENOENT:no such image"); return none; }
      const crop = kv.x || kv.y || kv.w || kv.h ? { x: Number(kv.x ?? 0), y: Number(kv.y ?? 0), w: Number(kv.w ?? 0) || img.width - Number(kv.x ?? 0), h: Number(kv.h ?? 0) || img.height - Number(kv.y ?? 0) } : undefined;
      const pxW = crop?.w ?? img.width, pxH = crop?.h ?? img.height;
      // Its box in cells: as the command says, else its pixels in the tile's cells (one side given: its aspect kept).
      let cols = Number(kv.c ?? 0), rows = Number(kv.r ?? 0);
      if (!cols && !rows) { cols = Math.ceil(pxW / geo.cellW); rows = Math.ceil(pxH / geo.cellH); }
      else if (!cols) cols = Math.max(1, Math.round((rows * geo.cellH * pxW) / pxH / geo.cellW));
      else if (!rows) rows = Math.max(1, Math.round((cols * geo.cellW * pxH) / pxW / geo.cellH));
      const pid = kv.p !== undefined ? Number(kv.p) : 0;
      const z = Number(kv.z ?? 0);
      answer("OK");
      const place = (at: Anchor, alt: boolean) => {
        // A placement made again under the same image and placement id moves: the old one goes.
        if (pid) this.placed = this.placed.filter(p => { const same = p.id === id && p.pid === pid; if (same) p.at.dispose(); return !same; });
        this.placed.push({ id, pid: pid || -++this.pidSeq, at, cols, rows, ...(crop ? { crop } : {}), z, alt });
      };
      // The cursor after it, as a kitty terminal moves it: right past it, on its last row (C=1: where it was).
      const move = kv.C === "1" ? "" : "\x1bD".repeat(Math.max(0, rows - 1)) + (cols ? `\x1b[${cols}C` : "");
      return { place, move };
    }
    return none;
  }

  /** `a=d`: by image id (`i`/`I`), with its pixels too when upper case; everything else clears what's placed. */
  private delete(kv: Record<string, string>, geo: TileGeometry) {
    const what = kv.d ?? "a", free = what === what.toUpperCase();
    const id = kv.i !== undefined ? Number(kv.i) : null, pid = kv.p !== undefined ? Number(kv.p) : null;
    const gone = (p: Placed) => {
      if (what.toLowerCase() === "i") return p.id === id && (pid === null || p.pid === pid);
      if (what.toLowerCase() === "a") return p.alt === geo.alt;
      return p.alt === geo.alt;
    };
    this.placed = this.placed.filter(p => { if (gone(p)) { p.at.dispose(); return false; } return true; });
    if (free) {
      if (what.toLowerCase() === "i" && id !== null) { if (!this.placed.some(p => p.id === id)) this.images.delete(id); }
      else for (const k of [...this.images.keys()]) if (!this.placed.some(p => p.id === k)) this.images.delete(k);
    }
  }

  /** The screen was cleared (ED 2: what's on it, from buffer line `from`; ED 3, `from` 0: the scrollback too), or reset. */
  cleared(alt: boolean, from = 0) {
    this.placed = this.placed.filter(p => { if (p.alt === alt && (!p.at.alive() || p.at.line() >= from)) { p.at.dispose(); return false; } return true; });
  }
  /** Everything gone (a full reset, a resync, a new start). */
  reset() { for (const p of this.placed) p.at.dispose(); this.placed = []; this.images.clear(); this.loading = null; }

  /**
   * What the tile shows of its placements: those on the screen showing (`alt`), from buffer line `top`, in a tile
   * `cols` × `rows`, cut to it (a picture half scrolled away shows its lower half; one wider than the tile, its left).
   * Placements whose line left the scrollback are let go here.
   */
  placements(top: number, cols: number, rows: number, alt: boolean): Placement[] {
    this.placed = this.placed.filter(p => p.at.alive() || (p.at.dispose(), false));
    // The alternate screen's pictures go with it (a full-screen program that quit).
    if (!alt && this.placed.some(p => p.alt)) this.placed = this.placed.filter(p => !p.alt || (p.at.dispose(), false));
    const out: Placement[] = [];
    for (const p of this.placed) {
      if (p.alt !== alt) continue;
      const img = this.images.get(p.id);
      if (!img) continue;
      const shown = within({ key: `g${p.id}.${p.pid}`, image: img.image, col: p.at.col, row: p.at.line() - top, cols: p.cols, rows: p.rows, z: p.z, ...(p.crop ? { crop: p.crop } : {}) }, { col: 0, row: 0, cols, rows });
      if (shown) out.push({ ...shown, key: `g${p.id}.${p.pid}` });
    }
    return out;
  }
}

/** A program's ask of the terminal's size in pixels (XTWINOPS 14: the text area, 16: a cell), answered as kitty does. */
export function windowOpsReply(op: number, geo: TileGeometry): string | null {
  if (op === 14) return `\x1b[4;${geo.rows * geo.cellH};${geo.cols * geo.cellW}t`;
  if (op === 16) return `\x1b[6;${geo.cellH};${geo.cellW}t`;
  return null;
}
