#!/usr/bin/env bun
// A made-up icat, for the showcase's pictures section (PIE-1555): it asks its terminal whether it draws kitty images, the
// way kitty's own icat, chafa and yazi ask (a graphics query, then DA1), and sends one picture if it does, else says so.
// `bun src/showcase/icat.ts [file]`: the file (any image sharp reads), or the showcase's made-up plot plan.
import sharp from "sharp";
import { join } from "node:path";

const file = process.argv[2] ?? join(import.meta.dir, "assets", "plot-plan.svg");
const png = await sharp(file).resize({ width: 320, withoutEnlargement: true }).png().toBuffer();
const out = (s: string) => process.stdout.write(s);

/** What the terminal answers a graphics query: true when its `_G` OK comes before its DA1 reply, as the protocol asks. */
async function drawsImages(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdin.setRawMode(true);
  out("\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c");
  let seen = "";
  const reader = process.stdin;
  const got = await new Promise<string>(resolve => {
    const done = () => { reader.off("data", on); clearTimeout(timer); resolve(seen); };
    const on = (d: Buffer) => { seen += d.toString("latin1"); if (/\x1b\[\?[\d;]*c/.test(seen)) done(); };
    const timer = setTimeout(done, 1500);
    reader.on("data", on);
  });
  const ok = got.indexOf("\x1b_Gi=31;OK"), da = got.search(/\x1b\[\?[\d;]*c/);
  return ok >= 0 && (da < 0 || ok < da);
}

if (await drawsImages()) {
  const b64 = png.toString("base64");
  for (let at = 0; at < b64.length; at += 4096) {
    const more = at + 4096 < b64.length ? 1 : 0;
    out(`\x1b_G${at === 0 ? "a=T,f=100,i=7,q=2," : ""}m=${more};${b64.slice(at, at + 4096)}\x1b\\`);
  }
  out("\r\n▣ the plot plan, drawn by a program in this tile (icat, made up)\r\n");
} else {
  out("icat: this terminal doesn't draw kitty images (the door draws them only under kitty graphics)\r\n");
}
// It stays, as a shell would after it: the picture stays with the text it was drawn beside.
process.stdin.resume();
