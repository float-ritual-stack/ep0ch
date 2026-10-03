// The docs site's done-check: every page renders dark with no light flash, and every example marked to run does.
//   bun site/check.ts            both
//   bun site/check.ts --pages    pages only (needs a Chromium: CHROME, else Playwright's headless shell)
//   bun site/check.ts --samples  samples only
//
// Samples run on a scratch outline host this script starts under a temp dir (never a real outline), with the
// repository's outliner and door. EP0CH_DOCS_REPO points at another checkout (a worktree with an unmerged feature).
//   <div class="code" data-run="sh" data-expect="…">     the block's text, run in bash; output must contain expect
//   <div class="code" data-run="note" data-query="k=v">  the block's text made a note, drawn with ep0ch show
//   <pre class="diff" data-run="edit" data-query="k=v">  the note the query finds gets the diff's + lines as its first lines
import { mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { decodePng } from "../packages/door/src/png-decode";

const SITE = import.meta.dir;
const REPO = resolve(process.env.EP0CH_DOCS_REPO ?? join(SITE, ".."));
const only = Bun.argv[2];
const pages = (function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === "vendor" ? [] : walk(join(dir, e.name))) : e.name.endsWith(".html") ? [join(dir, e.name)] : []);
})(SITE);
let failed = 0;
const fail = (what: string) => { failed++; console.log(`  ✗ ${what}`); };
const ok = (what: string) => console.log(`  ✓ ${what}`);
const unescape = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// ── Pages: dark before any stylesheet or script arrives, and dark when they have ──
async function checkPages() {
  console.log("pages");
  // The headless shell first: it honours a 400-wide window, where headless Chrome's own windows don't go under ~500.
  const pw = join(process.env.HOME!, ".cache/ms-playwright");
  const chrome = process.env.CHROME ?? [join(pw, "chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"), join(pw, "chromium-1243/chrome-linux64/chrome")].find(existsSync);
  if (!chrome) { fail("no Chromium: set CHROME to one"); return; }
  for (const page of pages) {
    const html = await Bun.file(page).text(), name = relative(SITE, page);
    // The head's first rule paints the ground, before any link, script or font.
    const head = html.slice(0, html.indexOf("</head>"));
    const firstStyle = head.indexOf("<style>html{background:"), firstLink = head.indexOf("<link"), firstScript = head.search(/<script[ >]/);
    if (!/<meta name="color-scheme" content="dark">/.test(head)) fail(`${name}: no color-scheme meta`);
    else if (firstStyle < 0 || (firstLink >= 0 && firstLink < firstStyle) || (firstScript >= 0 && firstScript < firstStyle)) fail(`${name}: the ground isn't painted before the first link or script`);
    else ok(`${name}: ground painted first, color-scheme dark`);
  }
  // Serve the site; /bare/… is a page with every stylesheet and script taken out: what paints before they arrive.
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const bare = path.startsWith("/bare/");
      const file = Bun.file(join(SITE, decodeURIComponent(bare ? path.slice(5) : path)));
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      if (!bare) return new Response(file);
      const text = (await file.text()).replace(/<link[^>]*>/g, "").replace(/<script src[^>]*><\/script>/g, "");
      return new Response(text, { headers: { "content-type": "text/html" } });
    },
  });
  const out = mkdtempSync(join(tmpdir(), "ep0ch-docs-shots-"));
  for (const page of pages) {
    const name = relative(SITE, page);
    for (const [label, url, w, h] of [["bare", `/bare/${name}`, 1280, 900], ["desktop", `/${name}`, 1280, 900], ["phone", `/${name}`, 400, 860]] as const) {
      const png = join(out, `${name.replace(/\W+/g, "-")}-${label}.png`);
      const p = Bun.spawn([chrome, ...(chrome.includes("headless-shell") ? [] : ["--headless=new"]), "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--window-size=${w},${h}`,
        "--virtual-time-budget=4000", `--screenshot=${png}`, `http://localhost:${server.port}${url}`], { stdout: "ignore", stderr: "ignore" });
      await p.exited;
      if (!existsSync(png)) { fail(`${name} (${label}): no screenshot`); continue; }
      const { w: pw, h: ph, data } = decodePng(Buffer.from(await Bun.file(png).arrayBuffer()));
      // Light pixels: luminance over 200 of 255. Text is allowed (it's thin); a light background is not.
      let light = 0, total = pw * ph;
      for (let i = 0; i < data.length; i += 4) if (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]! > 200) light++;
      const share = light / total, corner = [data[0], data[1], data[2]];
      if (share > 0.03 || corner.some(v => v! > 40)) fail(`${name} (${label}): ${(share * 100).toFixed(1)}% light pixels, corner rgb(${corner.join(" ")})`);
      else ok(`${name} (${label}, ${w}×${h}): ${(share * 100).toFixed(2)}% light pixels, ground rgb(${corner.join(" ")})`);
    }
  }
  server.stop(true);
  console.log(`  screenshots in ${out}`);
}

// ── Samples: run on a scratch host ──
async function checkSamples() {
  console.log(`samples (outliner and door from ${REPO})`);
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-docs-"));
  const env: Record<string, string> = { PATH: process.env.PATH!, HOME: process.env.HOME!, EP0CH_OUTLINES: join(dir, "o"), EP0CH_WS: "docs-check", EP0CH_STATE: join(dir, "state"), EP0CH_CONTROL: join(dir, "c.sock"), XDG_CONFIG_HOME: join(dir, "cfg"), OUTLINER_INBOX_AGENT: "0", OUTLINER_NOTE_ASSISTANCE: "0", EP0CH_DEFAULT_WS: "docs-check" };
  mkdirSync(join(dir, "o"), { recursive: true }); mkdirSync(join(dir, "cfg"), { recursive: true });
  const host = Bun.spawn(["bun", "src/host-main.ts"], { cwd: join(REPO, "packages/outliner"), env, stdout: "ignore", stderr: "ignore" });
  const prelude = `outliner() { bun ${REPO}/packages/outliner/src/cli.ts "$@"; }\nep0ch() { bun ${REPO}/packages/door/src/main.ts "$@"; }\n`;
  const sh = async (script: string) => {
    const p = Bun.spawn(["bash", "-c", prelude + script], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
    const [o, e] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
    return { code: await p.exited, out: o + e };
  };
  try {
    for (let i = 0; i < 100 && !existsSync(join(dir, "o/.host/host.sock")); i++) await Bun.sleep(100);
    const made = await sh("outliner outline create docs-check");
    if (made.code !== 0) { fail(`scratch outline: ${made.out}`); return; }
    for (const page of pages) {
      const html = await Bun.file(page).text(), name = relative(SITE, page);
      const blocks = [...html.matchAll(/<(div|pre) class="(?:code|diff)"([^>]*data-run="(\w+)"[^>]*)>([\s\S]*?)<\/pre>/g)];
      if (!blocks.length) continue;
      console.log(` ${name}`);
      for (const [, , attrs, kind, inner] of blocks) {
        const expect = /data-expect="([^"]*)"/.exec(attrs!)?.[1], query = /data-query="([^"]*)"/.exec(attrs!)?.[1];
        const code = unescape(inner!.replace(/^[\s\S]*?<pre[^>]*>/, ""));
        const short = code.split("\n")[0]!.slice(0, 80);
        let r: { code: number; out: string };
        if (kind === "sh") r = await sh(code);
        else if (kind === "note") {
          await Bun.write(join(dir, "note.md"), code);
          r = await sh(`outliner create --text "$(cat note.md)" >/dev/null && ep0ch show $(ep0ch find --ids --query ${JSON.stringify(query)}) --width 72`);
        } else if (kind === "edit") {
          const add = [...inner!.matchAll(/<span class="add">([\s\S]*?)<\/span>/g)].map(m => unescape(m[1]!));
          await Bun.write(join(dir, "first.txt"), add.join("\n"));
          r = await sh(`id=$(ep0ch find --ids --query ${JSON.stringify(query)} | tr -d '()'); rev=$(outliner read $id --fields revision | sed -n 's/.*"revision": *\\([0-9]*\\).*/\\1/p'); `
            + `text=$(outliner read $id --fields text | bun -e 'const t=JSON.parse(await Bun.stdin.text()); const b=Array.isArray(t)?t[0]:t; console.log(b.text.split("\\n").slice(1).join("\\n"))'); `
            + `outliner update --id $id --expected $rev --text "$(cat first.txt)\${text:+$'\\n'$text}" >/dev/null && sleep 1.2`);
        } else { fail(`${name}: data-run="${kind}" isn't a kind`); continue; }
        if (r.code !== 0) fail(`${short}\n${r.out.split("\n").slice(-8).join("\n")}`);
        else if (expect && !r.out.includes(expect)) fail(`${short}: no "${expect}" in\n${r.out}`);
        else ok(`${kind}: ${short}${expect ? `  → "${expect}"` : ""}`);
      }
    }
  } finally {
    host.kill(); await host.exited;
    rmSync(dir, { recursive: true, force: true });
  }
}

if (only !== "--samples") await checkPages();
if (only !== "--pages") await checkSamples();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
