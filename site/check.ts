// The docs site's done-check: every page renders dark with no light flash, and every example marked to run does.
//   bun site/check.ts            both
//   bun site/check.ts --pages    pages only (needs a Chromium: CHROME, else Playwright's headless shell)
//   bun site/check.ts --samples  samples only
//
// Samples run on a scratch outline host this script starts under a temp dir (never a real outline), with the
// repository's outliner and door, and with only what a reader has on PATH (`ep0ch`; never `outliner`). EP0CH_DOCS_REPO points at another checkout (a worktree with an unmerged feature).
//   <div class="code" data-run="sh" data-expect="…">     the block's text, run in bash; output must contain expect
//   <div class="code" data-run="note" data-query="k=v">  the block's text made a note, drawn with ep0ch show
//   <pre class="diff" data-run="edit" data-query="k=v">  the note the query finds gets the diff's + lines as its first lines
import { mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { SocketBoard } from "../packages/door/src/socket";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { decodePng } from "../packages/door/src/png-decode";
import { THEMES } from "../packages/door/src/theme";

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
// The no-flash head (DESIGN.md "No light flash") must paint the door's calm ground and running text.
const hexOf = (c: readonly number[]) => `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;
const firstPaint = `<style>html{background:${hexOf(THEMES.calm.ground ?? THEMES.calm.palette[0]!)};color:${hexOf(THEMES.calm.palette[7]!)};color-scheme:dark}</style>`;

async function checkPages() {
  console.log("pages");
  // The headless shell first: it honours a 400-wide window, where headless Chrome's own windows don't go under ~500.
  // Whichever Playwright build is installed (the newest), or CHROME.
  const pw = join(process.env.HOME!, ".cache/ms-playwright");
  const builds = (prefix: string, exe: string) => existsSync(pw) ? readdirSync(pw).filter(d => d.startsWith(prefix)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop())).map(d => join(pw, d, exe)) : [];
  const chrome = process.env.CHROME ?? [...builds("chromium_headless_shell-", "chrome-headless-shell-linux64/chrome-headless-shell"), ...builds("chromium-", "chrome-linux64/chrome")].find(existsSync);
  if (!chrome) { fail("no Chromium: set CHROME to one, or install Playwright's: bunx playwright install chromium-headless-shell"); return; }
  for (const page of pages) {
    const html = await Bun.file(page).text(), name = relative(SITE, page);
    // The head's first rule paints the ground, before any link, script or font.
    const head = html.slice(0, html.indexOf("</head>"));
    const firstStyle = head.indexOf("<style>html{background:"), firstLink = head.indexOf("<link"), firstScript = head.search(/<script[ >]/);
    if (!/<meta name="color-scheme" content="dark">/.test(head)) fail(`${name}: no color-scheme meta`);
    else if (!head.includes(firstPaint)) fail(`${name}: the head's first paint isn't the calm theme's ground and text: ${firstPaint}`);
    else if (firstStyle < 0 || (firstLink >= 0 && firstLink < firstStyle) || (firstScript >= 0 && firstScript < firstStyle)) fail(`${name}: the ground isn't painted before the first link or script`);
    else ok(`${name}: ground painted first, color-scheme dark`);
  }
  // Serve the site; /bare/… is a page with every stylesheet and script taken out: what paints before they arrive.
  const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const bare = path.startsWith("/bare/");
      const target = resolve(SITE, "." + decodeURIComponent(bare ? path.slice(5) : path));
      if (relative(SITE, target).startsWith("..")) return new Response("not found", { status: 404 });
      const file = Bun.file(target);
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
        "--virtual-time-budget=4000", `--screenshot=${png}`, `http://127.0.0.1:${server.port}${url}`], { stdout: "ignore", stderr: "ignore" });
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
  // Kept only when something failed, to look at; --keep-shots keeps them anyway.
  if (failed || Bun.argv.includes("--keep-shots")) console.log(`  screenshots in ${out}`);
  else rmSync(out, { recursive: true, force: true });
}

// ── Samples: run on a scratch host, with only what a reader has ──
// A reader has `ep0ch` on PATH (ep0ch install links it) and nothing else of ours: no `outliner`. So `sh` blocks run
// with an `ep0ch` that is this checkout's door on PATH, and any `outliner` there is taken off PATH. Making a note
// (`note`) and changing one (`edit`) are what a reader does in the door; here they go through the host's socket.
async function checkSamples() {
  console.log(`samples (outliner and door from ${REPO})`);
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-docs-"));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "ep0ch"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(REPO, "packages/door/src/main.ts"))} "$@"\n`, { mode: 0o755 });
  const path = [bin, ...process.env.PATH!.split(":").filter(d => d && !existsSync(join(d, "outliner")))].join(":");
  const sock = join(dir, "o/.host/host.sock");
  const env: Record<string, string> = { PATH: path, HOME: process.env.HOME!, EP0CH_OUTLINES: join(dir, "o"), EP0CH_WS: "docs-check", EP0CH_STATE: join(dir, "state"), EP0CH_CONTROL: join(dir, "c.sock"), XDG_CONFIG_HOME: join(dir, "cfg"), OUTLINER_INBOX_AGENT: "0", OUTLINER_NOTE_ASSISTANCE: "0", EP0CH_DEFAULT_WS: "docs-check" };
  mkdirSync(join(dir, "o"), { recursive: true }); mkdirSync(join(dir, "cfg"), { recursive: true });
  const log = join(dir, "host.log");
  const host = Bun.spawn([process.execPath, "src/host-main.ts"], { cwd: join(REPO, "packages/outliner"), env, stdout: Bun.file(log), stderr: Bun.file(log) });
  const sh = async (script: string) => {
    const p = Bun.spawn(["bash", "-c", script], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: o + e };
  };
  let board: SocketBoard | null = null;
  try {
    // Ready when the host answers a request (it makes the scratch outline, as a reader would), not when its socket
    // file appears; 60 s, then say why with its log.
    const started = Date.now();
    for (;;) {
      if (host.exitCode !== null) { fail(`the scratch host exited (${host.exitCode}):\n${await Bun.file(log).text()}`); return; }
      if (existsSync(sock)) {
        const made = await sh("ep0ch outline create docs-check");
        if (made.code === 0) break;
        if (Date.now() - started > 60_000) { fail(`ep0ch outline create docs-check, on the scratch host:\n${made.out}\nits log:\n${await Bun.file(log).text()}`); return; }
      } else if (Date.now() - started > 60_000) { fail(`the scratch host made no socket in 60 s; its log:\n${await Bun.file(log).text()}`); return; }
      await Bun.sleep(200);
    }
    board = new SocketBoard(sock);
    await board.info();
    for (const page of pages) {
      const html = await Bun.file(page).text(), name = relative(SITE, page);
      const blocks = [...html.matchAll(/<(div|pre) class="(?:code|diff)"([^>]*data-run="(\w+)"[^>]*)>([\s\S]*?)<\/pre>/g)];
      if (!blocks.length) continue;
      // A sample the pattern above can't read would go unchecked: every data-run must be one it read.
      const marked = [...html.matchAll(/data-run="/g)].length;
      if (marked !== blocks.length) fail(`${name}: ${marked} data-run samples, ${blocks.length} read (each is <div|pre class="code|diff" … data-run="…">…</pre>)`);
      console.log(` ${name}`);
      for (const [, , attrs, kind, inner] of blocks) {
        const expect = /data-expect="([^"]*)"/.exec(attrs!)?.[1], query = /data-query="([^"]*)"/.exec(attrs!)?.[1];
        const code = unescape(inner!.replace(/^[\s\S]*?<pre[^>]*>/, ""));
        const short = code.split("\n")[0]!.slice(0, 80);
        let r: { code: number; out: string };
        try {
          if (kind === "sh") r = await sh(code);
          else if (kind === "note") {
            // The note a reader writes in the door, made here through the host; then drawn with the reader's own command.
            await board!.createBlock(null, code);
            r = await sh(`ep0ch show $(ep0ch find --ids --query ${JSON.stringify(query)}) --width 72`);
          } else if (kind === "edit") {
            // The note's first lines replaced by the diff's + lines, as a reader saves it in the door; done when the
            // host reads it back changed.
            const add = [...inner!.matchAll(/<span class="add">([\s\S]*?)<\/span>/g)].map(m => unescape(m[1]!));
            const found = await sh(`ep0ch find --ids --query ${JSON.stringify(query)}`);
            const id = /\(\(([^)]+)\)\)/.exec(found.out)?.[1];
            const note = id ? await board!.read(id) : null;
            if (!note) { fail(`${name}: no note for ${query} (ep0ch find --ids --query ${JSON.stringify(query)}):\n${found.out}`); continue; }
            const dels = [...inner!.matchAll(/<span class="del">/g)].length;
            const text = [...add, ...note.text.split("\n").slice(Math.max(dels, 1))].join("\n");
            await board!.update(note.id, text, note.revision!);
            const back = await board!.read(note.id);
            r = back?.text === text ? { code: 0, out: back.text } : { code: 1, out: `the host read back:\n${back?.text}` };
          } else { fail(`${name}: data-run="${kind}" isn't a kind`); continue; }
        } catch (e) { r = { code: 1, out: e instanceof Error ? e.message : String(e) }; }
        if (r.code !== 0) fail(`${short}\n${r.out.split("\n").slice(-8).join("\n")}`);
        else if (expect && !r.out.includes(expect)) fail(`${short}: no "${expect}" in\n${r.out}`);
        else ok(`${kind}: ${short}${expect ? `  → "${expect}"` : ""}`);
      }
    }
  } finally {
    board?.close();
    host.kill(); await host.exited;
    rmSync(dir, { recursive: true, force: true });
  }
}

if (only !== "--samples") await checkPages();
if (only !== "--pages") await checkSamples();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
