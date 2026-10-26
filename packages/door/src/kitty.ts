// Kitty graphics: upload each distinct image once, then only place / unplace it.
// Everything here writes escape strings into a sink; the caller owns stdout.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Rgba } from "./vga";
import type { PngRef } from "./media";
import type { SizedText } from "./text-sizing";

export interface Placement {
  key: string;          // stable identity of this placement on screen
  image: Rgba | PngRef;
  col: number;          // 0-based cell position
  row: number;
  cols: number;         // cells the image is scaled into
  rows: number;
  z?: number;           // < 0 draws under text
  /** Source rectangle in image pixels: show only this part (reveal, scroll) without re-uploading. */
  crop?: { x: number; y: number; w: number; h: number };
  /** Text drawn at a size, not a picture (src/text-sizing.ts): `image` is then a stand-in, and the KittyLayer leaves it to the SizedLayer. */
  sized?: SizedText;
}

/**
 * `p`, laid on row `p.row` of a body, as shown through a window of `room` rows from body row `top`, drawn from row
 * `at`: cut to the rows in view, its `crop` showing only that part of the image (a scrolled reader, a river
 * column); null when none of it is in view.
 */
export function inWindow(p: Placement, top: number, room: number, at = 0): Placement | null {
  const start = p.row - top, end = start + p.rows;
  if (end <= 0 || start >= room) return null;
  const cutTop = Math.max(0, -start), cutBottom = Math.max(0, end - room), rows = p.rows - cutTop - cutBottom;
  // Cut from the part already shown (a header's cover crop), else from the whole image.
  const base = p.crop ?? { x: 0, y: 0, w: p.image.width, h: p.image.height };
  const crop = cutTop || cutBottom ? { x: base.x, y: base.y + Math.round((cutTop / p.rows) * base.h), w: base.w, h: Math.max(1, Math.round((rows / p.rows) * base.h)) } : p.crop;
  return { ...p, row: at + Math.max(0, start), rows, crop };
}

const APC = (body: string, payload = "") => `\x1b_G${body}${payload ? ";" + payload : ""}\x1b\\`;

/**
 * Herdr presents panes as xterm-256color even with its Kitty compositor on, so the
 * in-band query is not trusted there; its config says whether graphics are forwarded.
 */
function herdrGraphics(env = process.env): boolean | null {
  if (env.HERDR_ENV !== "1") return null;
  try {
    const home = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
    const cfg = Bun.TOML.parse(readFileSync(env.HERDR_CONFIG_PATH || join(home, "herdr", "config.toml"), "utf8")) as {
      terminal?: { kitty_graphics?: unknown };
      experimental?: { kitty_graphics?: unknown };
    };
    // Current Herdr keeps it under [terminal]; older builds under [experimental].
    return (cfg.terminal?.kitty_graphics ?? cfg.experimental?.kitty_graphics) === true;
  } catch { return false; }
}

/** Static decision; `null` means "ask the terminal". */
export function kittyHint(env = process.env): boolean | null {
  if (env.EP0CH_KITTY === "1") return true;
  if (env.EP0CH_KITTY === "0") return false;
  const herdr = herdrGraphics(env);
  if (herdr !== null) return herdr;
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty" || env.TERM_PROGRAM === "ghostty" || env.TERM === "xterm-ghostty") return true;
  return null;
}

/** Query sent at startup; a `_G` reply before the DA1 reply means graphics work. */
export const KITTY_QUERY = APC("i=31,s=1,v=1,a=q,t=d,f=24", "AAAA") + "\x1b[c";

/**
 * Uploads and placements go with `q=1`: the terminal's OKs are kept quiet, its errors are not. A terminal that lost an
 * image (it restarted, a client reattached to it, it evicted the image) answers a placement of it with ENOENT; the
 * terminal reader hands that to `forget` (PIE-795), and the next frame uploads it again. Deletions stay `q=2`: one of
 * an image the terminal no longer has needs no answer.
 */
/**
 * Placement `p` with what `r` (a dock sliding over, your drawer, the power bar, a hint card, a popup, a tile drawn later)
 * covers taken away: whole when `r` misses it; else the bands still showing above, below, left and right of `r`, each
 * the same uploaded image placed with its crop (PIE-794: a spine's title under your drawer is cut at its edge; PIE-1191: a
 * header image under a hint card keeps what the card leaves). A text-sized title can't be cut, so it goes whole.
 */
export function uncovered(p: Placement, r: { col: number; row: number; cols: number; rows: number }): Placement[] {
  const overlaps = p.col < r.col + r.cols && p.col + p.cols > r.col && p.row < r.row + r.rows && p.row + p.rows > r.row;
  if (!overlaps) return [p];
  if (p.sized) return [];
  const from = p.crop ?? { x: 0, y: 0, w: p.image.width, h: p.image.height };
  // The cover's edges in the placement's cells, and a cell edge's pixel in the crop (floored, so bands tile exactly).
  const top = Math.max(0, r.row - p.row), bottom = Math.min(p.rows, r.row + r.rows - p.row);
  const left = Math.max(0, r.col - p.col), right = Math.min(p.cols, r.col + r.cols - p.col);
  const y = (row: number) => from.y + Math.floor((from.h * row) / p.rows), x = (col: number) => from.x + Math.floor((from.w * col) / p.cols);
  const band = (name: string, c0: number, r0: number, c1: number, r1: number): Placement | null => {
    if (c1 <= c0 || r1 <= r0) return null;
    const crop = { x: x(c0), y: y(r0), w: Math.max(1, x(c1) - x(c0)), h: Math.max(1, y(r1) - y(r0)) };
    return { ...p, key: `${p.key}${name}`, col: p.col + c0, row: p.row + r0, cols: c1 - c0, rows: r1 - r0, crop };
  };
  const bands = [
    band("·above", 0, 0, p.cols, top), band("·below", 0, bottom, p.cols, p.rows),
    band("·left", 0, top, left, bottom), band("·right", right, top, p.cols, bottom),
  ].filter((b): b is Placement => b !== null);
  // One band keeps the placement's own key, so a picture cut only at one edge stays the same placement as it moves.
  return bands.length === 1 ? [{ ...bands[0]!, key: p.key }] : bands;
}
/** The part of placement `p` inside `r` (cropped as `uncovered` crops), or null when none is. */
export function within(p: Placement, r: { col: number; row: number; cols: number; rows: number }): Placement | null {
  const top = Math.max(0, r.row - p.row), bottom = Math.min(p.rows, r.row + r.rows - p.row);
  const left = Math.max(0, r.col - p.col), right = Math.min(p.cols, r.col + r.cols - p.col);
  if (bottom <= top || right <= left) return null;
  if (top === 0 && left === 0 && bottom === p.rows && right === p.cols) return p;
  if (p.sized) return null;
  const from = p.crop ?? { x: 0, y: 0, w: p.image.width, h: p.image.height };
  const y = (row: number) => from.y + Math.floor((from.h * row) / p.rows), x = (col: number) => from.x + Math.floor((from.w * col) / p.cols);
  const crop = { x: x(left), y: y(top), w: Math.max(1, x(right) - x(left)), h: Math.max(1, y(bottom) - y(top)) };
  return { ...p, key: `${p.key}·within`, col: p.col + left, row: p.row + top, cols: right - left, rows: bottom - top, crop };
}
/** `ps` with what `r` covers taken away (uncovered). */
export const uncover = (ps: Placement[], r: { col: number; row: number; cols: number; rows: number }): Placement[] => ps.flatMap(p => uncovered(p, r));

export class KittyLayer {
  private uploaded = new Map<string, number>();   // content hash → image id
  private placed = new Map<string, { id: number; pid: number; sig: string }>();
  private nextId = 7_000 + Math.floor(Math.random() * 1_000_000);
  private pidSeq = 0;
  bytesSent = 0;

  constructor(private readonly write: (s: string) => void) {}

  private upload(img: Rgba | PngRef): number {
    const png = "png" in img;
    const hash = png ? `png:${img.key}` : createHash("sha1").update(img.data).update(`${img.width}x${img.height}`).digest("hex");
    const known = this.uploaded.get(hash);
    if (known) return known;
    const id = this.nextId++;
    // PNG files go as-is (f=100); our own rasters go as raw RGBA + zlib (o=z), small over SSH either way.
    const b64 = png ? img.png.toString("base64") : deflateSync(img.data).toString("base64");
    const head0 = png ? `a=t,f=100,t=d,i=${id},q=1` : `a=t,f=32,o=z,t=d,i=${id},s=${img.width},v=${img.height},q=1`;
    let out = "";
    for (let at = 0; at < b64.length; at += 4096) {
      const more = at + 4096 < b64.length ? 1 : 0;
      out += APC(at === 0 ? `${head0},m=${more}` : `m=${more}`, b64.slice(at, at + 4096));
    }
    this.bytesSent += out.length;
    this.write(out);
    this.uploaded.set(hash, id);
    return id;
  }

  /** Make the screen's placements exactly `wanted`: unchanged ones stay put, the rest move or go. */
  sync(wanted: Placement[]): void {
    const next = new Map<string, { p: Placement; id: number; sig: string }>();
    for (const p of wanted) {
      const id = this.upload(p.image);
      const crop = p.crop ? `,x=${p.crop.x},y=${p.crop.y},w=${p.crop.w},h=${p.crop.h}` : "";
      next.set(p.key, { p, id, sig: `${id}@${p.col},${p.row},${p.cols}x${p.rows},z${p.z ?? 0}${crop}` });
    }
    let out = "";
    // Deletions first, and placement ids unique for the whole session, so a new placement of an
    // image can never be replaced by, or deleted as, an old placement that shared its id.
    for (const [key, prev] of this.placed) {
      if (next.get(key)?.sig === prev.sig) continue;
      out += APC(`a=d,d=i,i=${prev.id},p=${prev.pid},q=2`);
      this.placed.delete(key);
    }
    for (const [key, { p, id, sig }] of next) {
      if (this.placed.has(key)) continue;
      const pid = ++this.pidSeq;
      const crop = p.crop ? `,x=${p.crop.x},y=${p.crop.y},w=${p.crop.w},h=${p.crop.h}` : "";
      out += `\x1b7\x1b[${p.row + 1};${p.col + 1}H` +
        APC(`a=p,i=${id},p=${pid},c=${p.cols},r=${p.rows}${crop},C=1,z=${p.z ?? 0},q=1`) + "\x1b8";
      this.placed.set(key, { id, pid, sig });
    }
    if (out) this.write(out);
  }

  /**
   * The terminal no longer has image `id` (it answered ENOENT): forget its upload and its placements, so the next
   * `sync` uploads it again and places it afresh. False when the id isn't one this layer uploaded (another layer's).
   */
  forget(id: number, now = Date.now()): boolean {
    const hash = [...this.uploaded].find(([, at]) => at === id)?.[0];
    if (hash === undefined) return false;
    // An image the terminal keeps refusing (too big for it, or it never takes the upload) isn't sent again and again:
    // three times a minute at most, then left as it is until a minute has passed.
    const lost = (this.lost.get(hash) ?? []).filter(at => now - at < 60_000);
    if (lost.length >= 3) return false;
    this.lost.set(hash, [...lost, now]);
    this.uploaded.delete(hash);
    for (const [key, placed] of this.placed) if (placed.id === id) this.placed.delete(key);
    return true;
  }
  /** When each image was last found lost, by content: the bound on uploading it again. */
  private lost = new Map<string, number[]>();

  /** Remove every placement but keep uploaded pixels for reuse. */
  clear(): void { this.sync([]); }

  /** On exit: free all image data this process uploaded. */
  dispose(): void {
    let out = "";
    for (const id of this.uploaded.values()) out += APC(`a=d,d=I,i=${id},q=2`);
    this.uploaded.clear(); this.placed.clear();
    if (out) this.write(out);
  }
}
