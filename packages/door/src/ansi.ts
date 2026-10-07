// ANSI.SYS-style interpreter for 1990s art: CP437 bytes in, a grid of VGA cells out.
// Deliberately not an xterm: 80-column wrap, bold = bright foreground,
// blink = bright background when iCE colours are on, ^Z ends the file.

export const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const CP437_LOW = "\0☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼";

export const VGA_RGB: readonly [number, number, number][] = [
  [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170], [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
  [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255], [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
];
// SGR 30–37 order (black red green yellow blue magenta cyan white) → VGA palette index.
export const SGR_TO_VGA = [0, 4, 2, 6, 1, 5, 3, 7];

/** One screen cell. `code` is the CP437 byte, so the rasterizer can index the font directly. */
export interface Cell { code: number; fg: number; bg: number }

export interface Sauce {
  title: string; author: string; group: string; date: string;
  width: number; height: number; ice: boolean; comments: string[];
}

export interface Art {
  name: string;
  width: number;
  height: number;
  rows: Cell[][];
  sauce: Sauce | null;
  bytes: number;
}

/** Every glyph a VGA (CP437) font has, by its code: the low symbols, ⌂, and the high half. */
const CP437_CODES = new Map<string, number>([...[...CP437_LOW].slice(1).map((c, i) => [c, i + 1] as const), ["⌂", 127], ...[...CP437_HIGH].map((c, i) => [c, 128 + i] as const)]);

/**
 * The glyphs the door draws that a VGA font lacks, each as the nearest one it has. A kitty+crt screen's font is
 * CP437, so these go to the terminal as their lookalike (term bytes, App.paint) and the snapshot mirror draws the
 * same (PIE-509, PIE-510): Enter as ◄, a dash as ─, ✓ as √, the lock chip's □ ▣ as ○ ◙, a float's ⧉ as ◘ and its
 * ◢ corner as ┘, a tile menu's ⋯ as ≡ and its ✕ as x, dock handles' arrows, an ellipsis as ·, an old sparkline's steps as _ ▄ █, the river's types.
 */
export const CP437_NEAREST: ReadonlyMap<string, string> = new Map([
  // Callout icons (outline-core's callouts.ts, and the showcase's own type).
  ["△", "▲"], ["※", "*"], ["♨", "☼"],
  ["◆", "♦"], ["◇", "♦"], ["▸", "►"], ["▶", "►"], ["◂", "◄"], ["▾", "▼"], ["⇤", "←"], ["⇐", "←"], ["⇒", "→"], ["⇓", "↓"], ["⇥", "→"],
  ["⤒", "↑"], ["⤓", "↓"], ["⇱", "↑"], ["⠿", "■"], ["▭", "■"], ["✉", "■"], ["⌖", "☼"], ["⟳", "☼"], ["✦", "☼"], ["⊙", "☼"], ["⏎", "◄"],
  ["—", "─"], ["–", "-"], ["−", "-"], ["✓", "√"], ["✗", "x"], ["×", "x"], ["□", "○"], ["☐", "○"], ["◌", "○"], ["◎", "○"], ["▣", "◙"],
  ["⧉", "◘"], ["◢", "┘"], ["⋯", "≡"], ["✕", "x"], ["╭", "┌"], ["╮", "┐"], ["╰", "└"], ["╯", "┘"], ["…", "·"], ["›", ">"], ["“", '"'], ["”", '"'], ["❝", '"'],
  ["✎", "*"], ["●", "•"], ["⚠", "‼"], ["ℹ", "i"], ["┊", "│"], ["▦", "▒"], ["▤", "≡"], ["◧", "▌"], ["⑂", "¥"],
  // The flow figure's thin line and the budget meter's limit mark (src/figures/flow.ts, src/graphs.ts).
  ["┄", "-"], ["┃", "│"],
  ["▁", "_"], ["▂", "▄"], ["▃", "▄"], ["▅", "█"], ["▆", "█"], ["▇", "█"],
  // A terminal tile's program status (src/desk/program-status.ts): the working spinner's quarters, a login waited for.
  ["◴", "○"], ["◷", "○"], ["◶", "○"], ["◵", "○"], ["⚿", "§"],
  // `ep0ch install`'s spinner (src/setup/progress.ts), run in a door tile: it still turns, as | / - \.
  ["⣾", "|"], ["⣽", "/"], ["⣻", "-"], ["⢿", "\\"], ["⡿", "|"], ["⣟", "/"], ["⣯", "-"], ["⣷", "\\"],
]);
const NEAREST_RE = new RegExp(`[${[...CP437_NEAREST.keys()].join("")}]`, "gu");

/** `s` with every glyph a VGA font lacks swapped for its lookalike (CP437_NEAREST); the rest as it is. */
export const toCp437Glyphs = (s: string): string => s.replace(NEAREST_RE, ch => CP437_NEAREST.get(ch)!);

/** The VGA font's code for `ch`: ASCII as itself, a CP437 glyph's code, a lookalike's, or 63 (?) when it has none. */
export function cp437Code(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c < 128 && ch.length === 1) return c;
  return CP437_CODES.get(ch) ?? CP437_CODES.get(CP437_NEAREST.get(ch) ?? "") ?? (CP437_NEAREST.get(ch)?.charCodeAt(0) ?? 63);
}
/** Does a VGA font draw `ch` as itself? */
export const inCp437 = (ch: string) => (ch.length === 1 && ch.charCodeAt(0) < 128) || CP437_CODES.has(ch);

export function glyph(code: number): string {
  if (code < 32) return code === 0 ? " " : CP437_LOW[code]!;
  if (code === 127) return "⌂";
  return code < 128 ? String.fromCharCode(code) : CP437_HIGH[code - 128]!;
}

function text(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b < 128 ? String.fromCharCode(b) : CP437_HIGH[b - 128]!;
  return out.replace(/\0/g, " ").trimEnd();
}

export function readSauce(bytes: Uint8Array): { sauce: Sauce | null; dataEnd: number } {
  if (bytes.length < 128) return { sauce: null, dataEnd: bytes.length };
  const tail = bytes.subarray(bytes.length - 128);
  if (String.fromCharCode(...tail.subarray(0, 7)) !== "SAUCE00") return { sauce: null, dataEnd: bytes.length };
  const view = new DataView(tail.buffer, tail.byteOffset, 128);
  const commentLines = tail[104]!;
  let dataEnd = bytes.length - 128;
  const comments: string[] = [];
  const commentStart = dataEnd - 5 - commentLines * 64;
  if (commentLines > 0 && commentStart >= 0 && String.fromCharCode(...bytes.subarray(commentStart, commentStart + 5)) === "COMNT") {
    for (let i = 0; i < commentLines; i++) {
      const at = commentStart + 5 + i * 64;
      comments.push(text(bytes.subarray(at, at + 64)));
    }
    dataEnd = commentStart;
  }
  return {
    dataEnd,
    sauce: {
      title: text(tail.subarray(7, 42)),
      author: text(tail.subarray(42, 62)),
      group: text(tail.subarray(62, 82)),
      date: text(tail.subarray(82, 90)),
      width: view.getUint16(96, true),
      height: view.getUint16(98, true),
      ice: (tail[105]! & 1) === 1,
      comments,
    },
  };
}

const MAX_ROWS = 2000;

export function parseAnsi(name: string, bytes: Uint8Array, opts: { ice?: boolean } = {}): Art {
  const { sauce, dataEnd } = readSauce(bytes);
  const width = sauce?.width && sauce.width <= 320 ? sauce.width : 80;
  const ice = opts.ice ?? sauce?.ice ?? false;
  const rows: Cell[][] = [];
  let x = 0, y = 0, savedX = 0, savedY = 0;
  let fg = 7, bg = 0, bold = false, blink = false, inverse = false;
  const row = (n: number) => {
    while (rows.length <= n) rows.push(Array.from({ length: width }, () => ({ code: 32, fg: 7, bg: 0 })));
    return rows[n]!;
  };
  const put = (code: number) => {
    if (x >= width) { x = 0; y++; }
    if (y >= MAX_ROWS) return;
    let f = bold ? fg | 8 : fg;
    let b = ice && blink ? bg | 8 : bg;
    if (inverse) [f, b] = [b, f];
    row(y)[x] = { code, fg: f, bg: b };
    x++;
  };
  for (let i = 0; i < dataEnd; i++) {
    const c = bytes[i]!;
    if (c === 0x1a) break;
    if (c === 0x1b && bytes[i + 1] === 0x5b) {
      let j = i + 2, params = "";
      while (j < dataEnd && ((bytes[j]! >= 0x30 && bytes[j]! <= 0x3f))) params += String.fromCharCode(bytes[j++]!);
      const final = String.fromCharCode(bytes[j] ?? 0);
      i = j;
      const nums = params.replace(/[?=]/g, "").split(";").map(p => (p === "" ? NaN : Number(p)));
      const n = (k: number, d: number) => (Number.isFinite(nums[k]!) ? nums[k]! : d);
      switch (final) {
        case "A": y = Math.max(0, y - n(0, 1)); break;
        case "B": y += n(0, 1); break;
        case "C": x = Math.min(width - 1, x + n(0, 1)); break;
        case "D": x = Math.max(0, x - n(0, 1)); break;
        case "H": case "f": y = Math.max(0, n(0, 1) - 1); x = Math.max(0, Math.min(width - 1, n(1, 1) - 1)); break;
        case "J": if (n(0, 0) === 2) { rows.length = 0; x = 0; y = 0; } break;
        case "K": { const r = row(y); for (let k = x; k < width; k++) r[k] = { code: 32, fg: 7, bg: 0 }; break; }
        case "s": savedX = x; savedY = y; break;
        case "u": x = savedX; y = savedY; break;
        case "m":
          for (const p of params === "" ? [0] : nums.map(v => (Number.isFinite(v) ? v : 0))) {
            if (p === 0) { fg = 7; bg = 0; bold = false; blink = false; inverse = false; }
            else if (p === 1) bold = true;
            else if (p === 5 || p === 6) blink = true;
            else if (p === 7) inverse = true;
            else if (p === 22) bold = false;
            else if (p === 25) blink = false;
            else if (p === 27) inverse = false;
            else if (p >= 30 && p <= 37) fg = SGR_TO_VGA[p - 30]!;
            else if (p >= 40 && p <= 47) bg = SGR_TO_VGA[p - 40]!;
            else if (p === 39) fg = 7;
            else if (p === 49) bg = 0;
          }
          break;
      }
      continue;
    }
    if (c === 13) { x = 0; continue; }
    if (c === 10) { y++; row(y); continue; }
    if (c === 9) { x = Math.min(width, (Math.floor(x / 8) + 1) * 8); continue; }
    put(c);
  }
  while (rows.length > 1 && rows[rows.length - 1]!.every(cell => cell.code === 32 && cell.bg === 0)) rows.pop();
  return { name, width, height: rows.length, rows, sauce, bytes: bytes.length };
}
