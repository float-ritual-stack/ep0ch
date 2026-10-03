// Kitty graphics: upload each distinct image once, then only place / unplace it.
// Everything here writes escape strings into a sink; the caller owns stdout.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Rgba } from "./vga";
import type { PngRef } from "./media";

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
    const head0 = png ? `a=t,f=100,t=d,i=${id},q=2` : `a=t,f=32,o=z,t=d,i=${id},s=${img.width},v=${img.height},q=2`;
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
        APC(`a=p,i=${id},p=${pid},c=${p.cols},r=${p.rows}${crop},C=1,z=${p.z ?? 0},q=2`) + "\x1b8";
      this.placed.set(key, { id, pid, sig });
    }
    if (out) this.write(out);
  }

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
