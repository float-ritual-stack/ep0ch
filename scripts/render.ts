// Render pack members to PNG files for eyeballing: bun scripts/render.ts SHY-EMNU.ANS [...]
import { mkdirSync, writeFileSync } from "node:fs";
import { find } from "../src/packs";
import { loadArt } from "../src/packs";
import { encodePng, rasterize } from "../src/vga";

mkdirSync("out", { recursive: true });
for (const file of process.argv.slice(2)) {
  const m = find(file);
  if (!m) { console.error(`not found: ${file}`); continue; }
  const art = loadArt(m);
  const png = encodePng(rasterize(art.rows, 0, 0, art.width, Math.min(art.height, 60)));
  writeFileSync(`out/${file}.png`, png);
  console.log(file, m.pack.split("/").pop(), `${art.width}x${art.height}`, art.sauce ? `${art.sauce.title} / ${art.sauce.author} / ${art.sauce.group} ice=${art.sauce.ice}` : "no sauce");
}
