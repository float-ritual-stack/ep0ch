// A still: the door's own drawing (`ep0ch show <id> --ansi`, or a cast's frame) as HTML for a `<pre class="term">`.
// The theme's palette colours become `var(--term-N)` so a still follows the page's calm/night switch; any other
// colour (a tint) stays as drawn.
//   bun site/still.ts <file.ansi>            the whole file
//   bun site/still.ts <file.cast> [frame]    one frame of a cast (default the first), e.g. a poster
import { THEMES } from "../packages/door/src/theme";

const byRgb = new Map(THEMES.calm.palette.map((rgb, i) => [rgb.join(","), `var(--term-${i})`]));
// Box drawing and blocks (U+2500–259F) and Latin are in every mono face; any other symbol is held to one cell.
const cell = (ch: string) => { const c = ch.codePointAt(0)!; return c >= 0x2100 && !(c >= 0x2500 && c <= 0x259f) ? `<span class="g">${ch}</span>` : ch; };
const esc = (s: string) => [...s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")].map(cell).join("");
const colour = (r: string, g: string, b: string) => byRgb.get(`${r},${g},${b}`) ?? `rgb(${r} ${g} ${b})`;

export function ansiToHtml(ansi: string): string {
  let fg: string | null = null, bg: string | null = null, bold = false, out = "", open = false;
  const flush = () => { if (open) { out += "</span>"; open = false; } };
  const start = () => {
    const style = [fg && `color:${fg}`, bg && `background:${bg}`, bold && "font-weight:700"].filter(Boolean).join(";");
    if (style) { out += `<span style="${style}">`; open = true; }
  };
  for (const part of ansi.replace(/\r/g, "").split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      const n = (m[1] || "0").split(";");
      for (let i = 0; i < n.length; i++) {
        const c = n[i];
        if (c === "0" || c === "") { fg = bg = null; bold = false; }
        else if (c === "1") bold = true;
        else if (c === "22") bold = false;
        else if (c === "39") fg = null;
        else if (c === "49") bg = null;
        else if ((c === "38" || c === "48") && n[i + 1] === "2") { const v = colour(n[i + 2]!, n[i + 3]!, n[i + 4]!); c === "38" ? (fg = v) : (bg = v); i += 4; }
      }
      flush(); start();
    } else if (!part.startsWith("\x1b")) out += esc(part);
  }
  flush();
  return out.replace(/[ \t]+$/gm, "");
}

if (import.meta.main) {
  const [file, frame] = Bun.argv.slice(2);
  if (!file) { console.error("usage: bun site/still.ts <file.ansi | file.cast> [frame]"); process.exit(2); }
  const text = await Bun.file(file).text();
  if (file.endsWith(".cast")) {
    const frames = text.trim().split("\n").slice(1).map(l => JSON.parse(l)).filter(e => e[1] === "o");
    const f = frames[Number(frame ?? 0)];
    if (!f) { console.error(`${file} has ${frames.length} frames`); process.exit(2); }
    console.log(ansiToHtml(f[2].replace(/^\x1b\[H\x1b\[2J/, "").replace(/\r\n/g, "\n")));
  } else console.log(ansiToHtml(text));
}
