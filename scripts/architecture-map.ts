// The architecture map (PIE-495): docs/architecture/map.json drawn as one self-contained HTML page in the
// door's skin. Every file:line in the map is checked against the two checkouts first; a citation that no
// longer points at what it names stops the run, so the map is regenerated honestly after each round.
//
//   bun scripts/architecture-map.ts                 check, then write out/architecture-map.html
//   bun scripts/architecture-map.ts --out <file>    check, then write <file>
//   bun scripts/architecture-map.ts --check         check only
//   bun scripts/architecture-map.ts --no-check      draw without checking (a draft)
//
// The outliner checkout is EP0CH_OUTLINER (as for the tests), else ../pi-herdr-outliner.
// The page works without script: CSS draws the frames and steps the trace; a small script adds stepping
// controls and chapter keys. It stores nothing. The ep0ch logo is drawn as text from the WoE packs when they
// are present (EP0CH_PACKS), through the welcome screen's own cropping, which drops contact lines.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type RepoId = "door" | "outliner";
type Ladder = "accidental" | "recognised" | "provisional" | "shared" | "stable";
type Status = "open" | "partial" | "resolved" | "no action";
interface Ref { r: RepoId; p: string; l: number; m: string }
interface Question { text: string; finding?: string; route?: string }
interface Structure {
  id: string; name: string; group: string; chapter: string; ladder: Ladder; was?: Ladder; tree?: "on" | "own" | "outside";
  dependsOn: string[]; does: string; built: string; refs: Ref[]; questions?: Question[];
}
interface Finding { id: string; line: number; title: string; status: Status; by?: string; note?: string; route?: string }
interface Step { label: string; at: string; what: string; gap?: boolean; ref: Ref }
interface MapData {
  version: number; title: string; about: string;
  verified: { door: string; outliner: string; on: string };
  repos: Record<RepoId, { name: string; url: string; branch: string }>;
  ladder: { id: Ladder; about: string }[];
  groups: { id: string; name: string; about: string }[];
  reviews: Record<string, { name: string; path: string }>;
  routes: Record<string, string>;
  findings: Finding[];
  chapters: { id: string; title: string; lede: string }[];
  structures: Structure[];
  trace: { title: string; about: string; steps: Step[] };
}

const ROOT = resolve(import.meta.dir, "..");
const MAP = join(ROOT, "docs/architecture/map.json");
const OUTLINER = resolve(process.env.EP0CH_OUTLINER ?? join(ROOT, "../pi-herdr-outliner"));
const CHECKOUT: Record<RepoId, string> = { door: ROOT, outliner: OUTLINER };

// ── the data, and whether it holds ─────────────────────────────────────────────────────────────────────────

export function loadMap(path = MAP): MapData {
  return JSON.parse(readFileSync(path, "utf8")) as MapData;
}

/** Problems with the map's own shape: unknown ids, chapters, groups, findings or routes. */
export function shapeProblems(d: MapData): string[] {
  const out: string[] = [];
  const ids = new Set<string>(), chapters = new Set(d.chapters.map(c => c.id)), groups = new Set(d.groups.map(g => g.id));
  const ladder = new Set(d.ladder.map(l => l.id)), findings = new Set(d.findings.map(f => f.id));
  for (const s of d.structures) {
    if (ids.has(s.id)) out.push(`${s.id}: the id is used twice`);
    ids.add(s.id);
  }
  for (const s of d.structures) {
    if (!chapters.has(s.chapter)) out.push(`${s.id}: no chapter ${s.chapter}`);
    if (!groups.has(s.group)) out.push(`${s.id}: no group ${s.group}`);
    if (!ladder.has(s.ladder) || (s.was && !ladder.has(s.was))) out.push(`${s.id}: not a ladder position (${s.ladder}${s.was ? `, was ${s.was}` : ""})`);
    for (const dep of s.dependsOn) if (!ids.has(dep)) out.push(`${s.id}: depends on ${dep}, which isn't in the map`);
    for (const q of s.questions ?? []) {
      if (!q.finding && !q.route) out.push(`${s.id}: a question with neither a finding nor a route`);
      if (q.finding && !findings.has(q.finding)) out.push(`${s.id}: no finding ${q.finding}`);
      if (q.route && !(q.route in d.routes)) out.push(`${s.id}: no route ${q.route}`);
    }
  }
  for (const f of d.findings) {
    if (!(f.id.split("-")[0]! in d.reviews)) out.push(`${f.id}: no review ${f.id.split("-")[0]}`);
    if (f.route && !(f.route in d.routes)) out.push(`${f.id}: no route ${f.route}`);
  }
  for (const st of d.trace.steps) if (!ids.has(st.at)) out.push(`trace "${st.label}": no structure ${st.at}`);
  return out;
}

/** Every citation checked against the checkouts: the cited line must contain what the map says is there. */
export function citationProblems(d: MapData, checkout = CHECKOUT): string[] {
  const out: string[] = [];
  const cache = new Map<string, string[] | null>();
  const lines = (r: RepoId, p: string) => {
    const key = `${r}:${p}`;
    if (!cache.has(key)) {
      const file = join(checkout[r], p);
      cache.set(key, existsSync(file) ? readFileSync(file, "utf8").split("\n") : null);
    }
    return cache.get(key)!;
  };
  const check = (where: string, ref: Ref) => {
    const ls = lines(ref.r, ref.p);
    if (!ls) return out.push(`${where}: ${ref.r} ${ref.p} doesn't exist in ${checkout[ref.r]}`);
    const at = ls[ref.l - 1];
    if (at === undefined || !at.includes(ref.m)) {
      const found = ls.findIndex(l => l.includes(ref.m));
      out.push(`${where}: ${ref.p}:${ref.l} doesn't contain ${JSON.stringify(ref.m)}${found >= 0 ? ` (it's at line ${found + 1})` : " (not in the file)"}`);
    }
  };
  for (const s of d.structures) for (const ref of s.refs) check(s.id, ref);
  for (const st of d.trace.steps) check(`trace "${st.label}"`, st.ref);
  for (const f of d.findings) {
    const review = d.reviews[f.id.split("-")[0]!];
    if (review) check(f.id, { r: "door", p: review.path, l: f.line, m: `${f.id.split("-")[1]} ` });
  }
  for (const r of ["door", "outliner"] as const) if (!existsSync(checkout[r])) out.unshift(`no ${r} checkout at ${checkout[r]}${r === "outliner" ? " (set EP0CH_OUTLINER)" : ""}`);
  return out;
}

// ── counting ───────────────────────────────────────────────────────────────────────────────────────────────

export function counts(d: MapData) {
  const open = d.findings.filter(f => f.status === "open" || f.status === "partial");
  const ladder = Object.fromEntries(d.ladder.map(l => [l.id, d.structures.filter(s => s.ladder === l.id).length])) as Record<Ladder, number>;
  return {
    structures: d.structures.length,
    kept: d.structures.filter(s => s.group === "kept").length,
    built: d.structures.filter(s => s.group !== "kept").length,
    open: open.length,
    routed: open.filter(f => f.route).length,
    resolved: d.findings.filter(f => f.status === "resolved").length,
    moved: d.structures.filter(s => s.was && s.was !== s.ladder).length,
    ladder,
  };
}

// ── drawing ────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Map prose: `code` spans, nothing else. */
const prose = (s: string) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const sid = (id: string) => `s-${id.replace(/\./g, "-")}`;
const DOTS = ".".repeat(240);

function refUrl(d: MapData, ref: Ref): string {
  const repo = d.repos[ref.r];
  return `${repo.url}/blob/${repo.branch}/${ref.p}#L${ref.l}`;
}
function refLink(d: MapData, ref: Ref): string {
  const where = `${ref.r === "outliner" ? "outliner " : ""}${ref.p}:${ref.l}`;
  return `<a class="ref" href="${esc(refUrl(d, ref))}">${esc(where)}</a>`;
}
function findingLink(d: MapData, id: string): string {
  const f = d.findings.find(x => x.id === id);
  const review = d.reviews[id.split("-")[0]!]!;
  const url = `${d.repos.door.url}/blob/${d.repos.door.branch}/${review.path}#L${f?.line ?? 1}`;
  return `<a class="fid" href="${esc(url)}" title="${esc(f?.title ?? "")}">${esc(id)}</a>`;
}

/** A dotted Shypht frame: `::.... title ....::` across the top, the same along the bottom. */
function frame(title: string, body: string, cls = "", id = ""): string {
  return `<section class="fr ${cls}"${id ? ` id="${id}"` : ""}>
<div class="fr-edge"><span>::</span><span class="dots">${DOTS.slice(0, 4)}</span>${title ? `<b class="fr-title">${title}</b>` : ""}<span class="dots fill">${DOTS}</span><span>::</span></div>
<div class="fr-body">${body}</div>
<div class="fr-edge"><span>::</span><span class="dots fill">${DOTS}</span><span>::</span></div>
</section>`;
}

const ladderBadge = (s: Structure) =>
  `<span class="lad l-${s.ladder}">${s.was && s.was !== s.ladder ? `<s>${s.was}</s> → ` : ""}${s.ladder}</span>`;

function card(d: MapData, s: Structure): string {
  const byId = new Map(d.structures.map(x => [x.id, x]));
  const deps = s.dependsOn.map(id => `<a class="chip g-${byId.get(id)!.group}" href="#${sid(id)}">${esc(byId.get(id)!.name)}</a>`).join(" ");
  const qs = (s.questions ?? []).map(q => {
    const f = q.finding ? d.findings.find(x => x.id === q.finding) : undefined;
    const st = f?.status ?? "open";
    const route = q.route ?? f?.route;
    return `<li><span class="st st-${st.replace(" ", "-")}">${esc(st)}</span> ${prose(q.text)}${q.finding ? ` ${findingLink(d, q.finding)}` : ""}${route ? ` <span class="route" title="${esc(d.routes[route] ?? "")}">→ ${esc(route)}</span>` : ` <span class="route none">not routed</span>`}</li>`;
  }).join("");
  const tree = s.tree === "outside" ? `<span class="tree t-out">outside the layout tree</span>` : s.tree === "own" ? `<span class="tree t-own">its own tree host</span>` : "";
  return `<article class="card g-${s.group} l-${s.ladder}${dashed(s.ladder) ? " dashed" : ""}" id="${sid(s.id)}">
<header><span class="grp">${esc(s.group)}</span><h3>${esc(s.name)}</h3>${ladderBadge(s)}${tree}</header>
<p class="does">${prose(s.does)}</p>
<p class="built"><span class="k">built</span> ${prose(s.built)}</p>
<p class="refs">${s.refs.map(r => refLink(d, r)).join(" ")}</p>
${deps ? `<p class="deps"><span class="k">rests on</span> ${deps}</p>` : ""}
${qs ? `<ul class="qs">${qs}</ul>` : ""}
</article>`;
}
const dashed = (l: Ladder) => l === "accidental" || l === "recognised" || l === "provisional";

/** The system so far: one row per chapter up to this one, the newest on top, earlier ones dimmer. */
function stack(d: MapData, upTo: number): string {
  const rows = d.chapters.slice(0, upTo + 1).map((c, i) => {
    const chips = d.structures.filter(s => s.chapter === c.id)
      .map(s => `<a class="chip g-${s.group} l-${s.ladder}${dashed(s.ladder) ? " dashed" : ""}" href="#${sid(s.id)}">${esc(s.name)}</a>`).join("");
    return `<div class="layer${i === upTo ? " now" : ""}"><a class="ln" href="#ch-${i + 1}">${String(i + 1).padStart(2, "0")}</a><div class="chips">${chips}</div></div>`;
  });
  return `<div class="stack" aria-label="the system up to this chapter">${rows.reverse().join("")}</div>`;
}

/** Chapter 8's picture: what's a preset on the tree, what hosts its own tree, what's outside it. */
function treeDiagram(d: MapData): string {
  const chip = (s: Structure) => `<a class="chip g-${s.group} l-${s.ladder}${dashed(s.ladder) ? " dashed" : ""}" href="#${sid(s.id)}">${esc(s.name)}</a>`;
  const desk = d.structures.find(s => s.id === "door.desk");
  const on = d.structures.filter(s => s.tree === "on");
  const own = d.structures.filter(s => s.tree === "own");
  const out = d.structures.filter(s => s.tree === "outside");
  return `<div class="treemap">
<div class="tm-tree"><div class="tm-label">the layout tree</div>${desk ? chip(desk) : ""}${on.map(chip).join("")}</div>
<div class="tm-own"><div class="tm-label">the tree's algebra, its own host</div>${own.map(chip).join("")}</div>
<div class="tm-out"><div class="tm-label">outside the tree (a later chapter)</div>${out.map(chip).join("")}</div>
</div>`;
}

function chapter(d: MapData, i: number): string {
  const c = d.chapters[i]!;
  const here = d.structures.filter(s => s.chapter === c.id);
  const prev = i > 0 ? `<a href="#ch-${i}" rel="prev">← ${esc(d.chapters[i - 1]!.title)}</a>` : `<a href="#top">↑ top</a>`;
  const next = i < d.chapters.length - 1 ? `<a href="#ch-${i + 2}" rel="next">${esc(d.chapters[i + 1]!.title)} →</a>` : `<a href="#trace">the trace →</a>`;
  const body = `<p class="lede">${prose(c.lede)}</p>
${stack(d, i)}
${c.id === "screens" ? treeDiagram(d) : ""}
<div class="cards">${here.map(s => card(d, s)).join("\n")}</div>
<nav class="chnav">${prev}<span class="sp"></span>${next}</nav>`;
  return frame(`${String(i + 1).padStart(2, "0")} · ${esc(c.title)}`, body, "chapter", `ch-${i + 1}`);
}

const LANE: Record<string, number> = { door: 0, socket: 1, service: 2 };
function laneOf(d: MapData, at: string): keyof typeof LANE {
  if (at === "door.socketboard") return "socket";
  const g = d.structures.find(s => s.id === at)?.group;
  return g === "service" ? "service" : "door";
}

function trace(d: MapData): string {
  const n = d.trace.steps.length, per = 1.6;
  const steps = d.trace.steps.map((st, i) => {
    const s = d.structures.find(x => x.id === st.at)!;
    const lane = laneOf(d, st.at);
    return `<li class="step lane-${lane}${st.gap ? " gap" : ""}" style="--i:${i}" id="t-${i + 1}">
<span class="num">${String(i + 1).padStart(2, "0")}</span><b class="lbl">${esc(st.label)}</b> <a class="chip g-${s.group}" href="#${sid(s.id)}">${esc(s.name)}</a>
<p>${prose(st.what)}</p><p class="refs">${refLink(d, st.ref)}${st.gap ? ` <span class="st st-open">gap</span>` : ""}</p></li>`;
  }).join("\n");
  const body = `<p class="lede">${prose(d.trace.about)}</p>
<div class="tr-lanes" aria-hidden="true"><span>door</span><span>the socket</span><span>service</span></div>
<ol class="trace" style="--n:${n};--per:${per}s">${steps}</ol>
<div class="tr-ctl" hidden><button type="button" data-t="prev">◄ step</button><button type="button" data-t="play">pause</button><button type="button" data-t="next">step ►</button><span class="tr-at"></span></div>`;
  return frame(`the trace · ${esc(d.trace.title)}`, body, "tracebox", "trace");
}

function findings(d: MapData): string {
  const byReview = Object.entries(d.reviews).map(([k, r]) => {
    const fs = d.findings.filter(f => f.id.startsWith(`${k}-`));
    const open = fs.filter(f => f.status === "open" || f.status === "partial").length;
    const rows = fs.map(f => `<tr class="st-row-${f.status.replace(" ", "-")}"><td>${findingLink(d, f.id)}</td><td>${prose(f.title)}${f.note ? `<div class="note">${prose(f.note)}</div>` : ""}</td><td><span class="st st-${f.status.replace(" ", "-")}">${esc(f.status)}</span></td><td>${f.by ? `by ${esc(f.by)}` : ""}${f.route ? ` <span class="route" title="${esc(d.routes[f.route] ?? "")}">→ ${esc(f.route)}</span>` : f.status === "open" || f.status === "partial" ? ` <span class="route none">not routed</span>` : ""}</td></tr>`).join("");
    return `<details${k === "A" ? " open" : ""}><summary>review ${k} · ${esc(r.name)} · ${fs.length} findings, ${open} open</summary>
<div class="tablewrap"><table><thead><tr><th>finding</th><th>what</th><th>now</th><th>by / next</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }).join("\n");
  const routes = Object.entries(d.routes).map(([k, v]) => `<li><b>${esc(k)}</b> ${prose(v)}</li>`).join("");
  return frame("the findings, then and now", `${byReview}<h4>where the open ones go</h4><ul class="routes">${routes}</ul>`, "", "findings");
}

// ── the logo ───────────────────────────────────────────────────────────────────────────────────────────────

const VGA = ["#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
  "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff"];

/** The dotted SHY-EPO! logo as coloured text, or null without the packs. Contact lines are cropped by logoCells. */
async function logo(): Promise<string | null> {
  try {
    const { artNamed } = await import("../src/packs");
    const { logoCells, LOGOS } = await import("../src/hub/welcome");
    const { glyph } = await import("../src/ansi");
    const first = LOGOS[0]!;
    const art = artNamed(first.file);
    if (!art) return null;
    const { rows } = logoCells(art, first);
    if (!rows.length) return null;
    return rows.map(r => {
      let line = "", fg = -1, run = "";
      const flush = () => { if (run) line += `<span style="color:${VGA[fg] ?? VGA[7]}">${esc(run)}</span>`; run = ""; };
      for (const c of r) { if (c.fg !== fg) { flush(); fg = c.fg; } run += glyph(c.code); }
      flush();
      return line;
    }).join("\n");
  } catch {
    return null;
  }
}

const FALLBACK_LOGO = `<span style="color:#555555">::......................................::</span>
<span style="color:#555555">::</span>  <span style="color:#ffffff">e p 0 c h</span>   <span style="color:#aaaaaa">architecture map</span>          <span style="color:#555555">::</span>
<span style="color:#555555">::......................................::</span>`;

// ── the page ───────────────────────────────────────────────────────────────────────────────────────────────

export async function render(d: MapData, opts: { logo?: string | null; commits?: Partial<Record<RepoId, string>> } = {}): Promise<string> {
  const c = counts(d);
  const art = opts.logo === undefined ? await logo() : opts.logo;
  const commits = { door: opts.commits?.door ?? d.verified.door, outliner: opts.commits?.outliner ?? d.verified.outliner };
  const ladderLegend = d.ladder.map(l => `<li><span class="lad l-${l.id}">${l.id}</span> <b>${c.ladder[l.id]}</b> <span class="dim">${esc(l.about)}</span></li>`).join("");
  const groupLegend = d.groups.map(g => `<li><span class="grp g-${g.id}">${esc(g.name)}</span> <b>${d.structures.filter(s => s.group === g.id).length}</b> <span class="dim">${esc(g.about)}</span></li>`).join("");
  const toc = d.chapters.map((ch, i) => `<li><a href="#ch-${i + 1}"><span class="ln">${String(i + 1).padStart(2, "0")}</span> ${esc(ch.title)}</a> <span class="dim">${d.structures.filter(s => s.chapter === ch.id).length}</span></li>`).join("");
  const n = d.trace.steps.length, per = 1.6;
  const on = (100 / n).toFixed(3), off = (100 / n + 0.001).toFixed(3);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ep0ch architecture map</title>
<meta name="description" content="${esc(d.about)}">
<style>
:root{color-scheme:dark;
--c0:#000000;--c1:#0000aa;--c2:#00aa00;--c3:#00aaaa;--c4:#aa0000;--c5:#aa00aa;--c6:#aa5500;--c7:#aaaaaa;
--c8:#555555;--c9:#5555ff;--c10:#55ff55;--c11:#55ffff;--c12:#ff5555;--c13:#ff55ff;--c14:#ffff55;--c15:#ffffff;
--bg:var(--c0);--fg:var(--c7);--hi:var(--c15);--dim:var(--c8);
--mono:"Px437 IBM VGA 9x16","Perfect DOS VGA 437",ui-monospace,"DejaVu Sans Mono","Cascadia Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}
html{background:var(--bg);scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 var(--mono);-webkit-text-size-adjust:100%}
a{color:var(--c11);text-decoration:none}a:hover,a:focus{color:var(--hi);text-decoration:underline}
code{color:var(--c14);font-family:var(--mono)}
main{max-width:1180px;margin:0 auto;padding:12px 16px 48px}
.dim{color:var(--dim)}
h1,h2,h3,h4{font-weight:normal;margin:0}
h4{color:var(--hi);margin:16px 0 6px}
/* the masthead: the logo drawn as text, sized to fit the width */
.mast{text-align:center;padding:8px 0 4px}
.logo{margin:0 auto;display:inline-block;text-align:left;font:min(13px,calc((100vw - 32px) / 48.5))/1.05 var(--mono);white-space:pre;overflow:hidden}
.mast h1{color:var(--hi);font-size:16px;margin-top:10px;letter-spacing:.2em;text-transform:lowercase}
.mast .sub{color:var(--dim);margin:4px 0 0;font-size:12px}
/* the top bar */
.top{position:sticky;top:0;z-index:5;background:var(--c1);color:var(--c15);display:flex;flex-wrap:wrap;gap:4px 18px;padding:4px 12px;margin:12px 0 18px;font-size:13px}
.top b{color:var(--c14);font-weight:normal}.top .k{color:var(--c11)}.top a{color:var(--c15)}
.top .sp{flex:1}
/* Shypht's dotted frames */
.fr{margin:0 0 22px}
.fr-edge{display:flex;white-space:nowrap;overflow:hidden;color:var(--dim);line-height:1.2}
.fr-edge .fill{flex:1;overflow:hidden}
.fr-title{color:var(--hi);font-weight:normal;padding:0 1ch;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80%}
.fr-body{border-left:2px dotted var(--dim);border-right:2px dotted var(--dim);margin:0 .45ch;padding:8px 1.5ch 10px}
.lede{color:var(--fg);max-width:78ch;margin:2px 0 12px}
/* legends */
.legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:4px 24px}
.legend ul,.toc{list-style:none;margin:0;padding:0}
.legend li,.toc li{margin:2px 0}
.toc{columns:2 280px}.toc .ln{color:var(--c14)}
/* ladder and group colours */
.lad{display:inline-block;padding:0 .6ch;border:1px solid currentColor;font-size:12px;white-space:nowrap}
.lad s{color:var(--dim)}
.l-accidental{--lc:var(--c12)}.l-recognised{--lc:var(--c14)}.l-provisional{--lc:var(--c11)}.l-shared{--lc:var(--c10)}.l-stable{--lc:var(--c15)}
.lad.l-accidental,.lad.l-recognised,.lad.l-provisional,.lad.l-shared,.lad.l-stable{color:var(--lc)}
.g-kept{--gc:var(--c7)}.g-service{--gc:var(--c9)}.g-door{--gc:var(--c13)}.g-clients{--gc:var(--c2)}
.grp{color:var(--gc);text-transform:uppercase;font-size:11px;letter-spacing:.1em}
/* the stack: the system so far, newest layer on top */
.stack{border-top:1px dotted var(--dim);border-bottom:1px dotted var(--dim);padding:4px 0;margin:0 0 14px}
.layer{display:flex;gap:10px;align-items:flex-start;padding:2px 0;opacity:.45}
.layer.now{opacity:1}
.layer .ln{color:var(--c14);flex:none;width:3ch}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{display:inline-block;padding:0 .7ch;border:1px solid var(--gc);color:var(--gc);font-size:12px;line-height:1.5;background:var(--c0)}
.chip.l-accidental,.chip.l-recognised,.chip.l-provisional,.chip.l-shared,.chip.l-stable{border-color:var(--lc)}
.chip.dashed{border-style:dashed}
.chip:hover{background:var(--c1);color:var(--hi);text-decoration:none}
/* cards */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{border:1px solid var(--lc);padding:8px 12px 10px;background:var(--c0);scroll-margin-top:48px}
.card.dashed{border-style:dashed}
.card:target{outline:2px solid var(--c14);outline-offset:2px}
.card header{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-bottom:6px}
.card h3{color:var(--hi);font-size:15px;flex:1 1 auto}
.card p,.step p,td{overflow-wrap:anywhere}
.card p{margin:4px 0}
.card .k{color:var(--c3);margin-right:.5ch}
.card .built{color:var(--fg)}
.card .does{color:#d8d8d8}
.refs{font-size:12px;line-height:1.7}
.ref{color:var(--c3);margin-right:1.2ch;white-space:nowrap}
.deps{font-size:12px}
.tree{font-size:11px;padding:0 .6ch}.t-out{color:var(--c12);border:1px dashed var(--c12)}.t-own{color:var(--c14);border:1px dashed var(--c14)}
.qs{list-style:none;margin:8px 0 0;padding:6px 0 0;border-top:1px dotted var(--dim);font-size:13px}
.qs li{margin:3px 0}
.st{display:inline-block;font-size:11px;padding:0 .5ch;text-transform:uppercase;letter-spacing:.05em}
.st-open{background:var(--c4);color:var(--c15)}.st-partial{background:var(--c6);color:var(--c15)}
.st-resolved{background:var(--c2);color:var(--c0)}.st-no-action{background:var(--c8);color:var(--c15)}
.fid{color:var(--c14)}
.route{color:var(--c13);white-space:nowrap}.route.none{color:var(--dim)}
.chnav{display:flex;gap:12px;margin-top:14px;font-size:13px}.chnav .sp{flex:1}
/* chapter 8: on the tree, beside it, outside it */
.treemap{display:grid;grid-template-columns:2fr 1fr 1.4fr;gap:12px;margin:0 0 16px}
.treemap>div{padding:8px 10px 10px;display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start}
.tm-label{width:100%;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}
.tm-tree{border:1px solid var(--c10)}.tm-tree .tm-label{color:var(--c10)}
.tm-own{border:1px dashed var(--c14)}.tm-own .tm-label{color:var(--c14)}
.tm-out{border:1px dashed var(--c8);opacity:.75}.tm-out .tm-label{color:var(--dim)}
/* the trace: a step lights up in turn, in the lane where it runs */
.tr-lanes{display:grid;grid-template-columns:repeat(3,1fr);color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px dotted var(--dim);margin-bottom:6px}
.tr-lanes span{padding-left:4px;border-left:1px dotted var(--dim)}
.trace{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);column-gap:10px;position:relative}
.step{grid-column:1;border:1px solid var(--c8);padding:6px 10px;margin:0 0 6px;font-size:13px;position:relative;background:var(--c0);
  animation:lit calc(var(--n) * var(--per)) steps(1,end) infinite;animation-delay:calc(var(--i) * var(--per))}
.step.lane-socket{grid-column:2}.step.lane-service{grid-column:3}
.step p{margin:3px 0}
.step .num{color:var(--c14);margin-right:1ch}.step .lbl{color:var(--hi);font-weight:normal}
.step.gap{border-style:dashed;border-color:var(--c12)}
.step::before{content:"";position:absolute;left:50%;top:-7px;height:6px;border-left:1px dotted var(--dim)}
.step:first-child::before{display:none}
@keyframes lit{0%,${on}%{border-color:var(--c14);background:var(--c1);box-shadow:0 0 0 1px var(--c14)}${off}%,100%{}}
.trace.manual .step{animation:none}
.trace.manual .step.at{border-color:var(--c14);background:var(--c1);box-shadow:0 0 0 1px var(--c14)}
.tr-ctl{display:flex;gap:8px;align-items:center;margin-top:10px}
.tr-ctl[hidden]{display:none}
button{font:13px var(--mono);background:var(--c1);color:var(--c15);border:1px solid var(--c9);padding:2px 10px;cursor:pointer}
button:hover,button:focus{background:var(--c9);outline:none}
.tr-at{color:var(--dim);font-size:12px}
@media (prefers-reduced-motion:reduce){.step{animation:none}}
/* findings */
details{margin:0 0 10px}
summary{cursor:pointer;color:var(--hi)}
summary::marker{color:var(--c14)}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}
th{text-align:left;color:var(--c11);font-weight:normal;border-bottom:1px dotted var(--dim);padding:3px 6px}
td{vertical-align:top;padding:3px 6px;border-bottom:1px dotted #222}
td .note{color:var(--dim);font-size:12px}
.st-row-resolved td:nth-child(2),.st-row-no-action td:nth-child(2){color:var(--dim)}
.routes{margin:0;padding-left:2ch}.routes b{color:var(--c13);font-weight:normal}
footer{color:var(--dim);font-size:12px;text-align:center;margin-top:20px}
/* phones */
@media (max-width:720px){
  body{font-size:13px}
  main{padding:8px 12px 40px}
  .cards{grid-template-columns:1fr}
  .treemap{grid-template-columns:1fr}
  .fr-body{padding:8px 1ch 10px}
  .top{font-size:12px;gap:2px 12px}
  .trace,.tr-lanes{grid-template-columns:1fr}
  .tr-lanes{display:none}
  .step,.step.lane-socket,.step.lane-service{grid-column:1}
  .step.lane-socket{margin-left:2ch}.step.lane-service{margin-left:4ch}
  .step::before{left:2ch}
}
</style></head>
<body id="top"><main>
<header class="mast">
<pre class="logo" aria-label="ep0ch">${art ?? FALLBACK_LOGO}</pre>
<h1>architecture map</h1>
<p class="sub">ep0ch-door ${esc(commits.door)} · pi-herdr-outliner ${esc(commits.outliner)} · checked ${esc(d.verified.on)}</p>
</header>
<nav class="top" aria-label="summary">
<span><span class="k">kept</span> <b>${c.kept}</b></span>
<span><span class="k">built on top</span> <b>${c.built}</b></span>
<span><span class="k">structures shown</span> <b>${c.structures}</b></span>
<span><span class="k">open questions</span> <b>${c.open}</b> open · <b>${c.routed}</b> routed</span>
<span class="sp"></span>
<a href="#trace">trace</a> <a href="#findings">findings</a>
</nav>
${frame("the map", `<p class="lede">${prose(d.about)}</p>
<p class="lede">Since the three reviews: ${c.resolved} findings resolved, ${c.moved} structures moved up the ladder (struck through: where the review found them). Dashed: still accidental, recognised or provisional.</p>
<div class="legend"><ul>${ladderLegend}</ul><ul>${groupLegend}</ul></div>
<h4>chapters</h4><ol class="toc">${toc}<li><a href="#trace"><span class="ln">→</span> the trace: ${esc(d.trace.title)}</a></li><li><a href="#findings"><span class="ln">→</span> the findings, then and now</a></li></ol>`, "", "about")}
${d.chapters.map((_, i) => chapter(d, i)).join("\n")}
${trace(d)}
${findings(d)}
<footer>generated from <code>docs/architecture/map.json</code> by <code>bun scripts/architecture-map.ts</code> · every file:line checked against the checkouts · ← → step chapters</footer>
</main>
<script>
(() => {
  // Stepping for the trace, and ← → between chapters. Nothing is stored.
  const list = document.querySelector(".trace"), ctl = document.querySelector(".tr-ctl");
  if (list && ctl) {
    const steps = [...list.querySelectorAll(".step")], at = ctl.querySelector(".tr-at");
    let i = -1, timer = null;
    const show = n => { i = (n + steps.length) % steps.length; steps.forEach((s, k) => s.classList.toggle("at", k === i)); at.textContent = (i + 1) + " / " + steps.length + " · " + steps[i].querySelector(".lbl").textContent; };
    const play = () => { list.classList.add("manual"); clearInterval(timer); timer = setInterval(() => show(i + 1), ${per * 1000}); ctl.querySelector('[data-t="play"]').textContent = "pause"; };
    const pause = () => { clearInterval(timer); timer = null; ctl.querySelector('[data-t="play"]').textContent = "play"; };
    ctl.hidden = false;
    ctl.addEventListener("click", e => {
      const t = e.target.closest("button")?.dataset.t;
      if (t === "prev") { pause(); list.classList.add("manual"); show(i - 1); }
      if (t === "next") { pause(); list.classList.add("manual"); show(i + 1); }
      if (t === "play") timer ? pause() : play();
    });
    steps.forEach((s, k) => s.addEventListener("click", ev => { if (ev.target.closest("a")) return; pause(); list.classList.add("manual"); show(k); }));
    show(0); play();
  }
  const chapters = [...document.querySelectorAll(".chapter, #trace, #findings")];
  document.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey || /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    // The chapter whose top is at or above the fold is the current one; → goes to the next, ← to the one before.
    const y = window.scrollY + 60;
    let cur = -1;
    chapters.forEach((c, k) => { if (c.offsetTop <= y) cur = k; });
    const to = e.key === "ArrowRight" ? chapters[cur + 1] : cur > 0 ? chapters[cur - 1] : document.body;
    if (to) { e.preventDefault(); to.scrollIntoView({ behavior: "smooth" }); }
  });
})();
</script>
</body></html>
`;
}

// ── the command ────────────────────────────────────────────────────────────────────────────────────────────

function head(dir: string): string | undefined {
  const r = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--short=7", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString().trim() : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const onlyCheck = args.includes("--check"), noCheck = args.includes("--no-check");
  const outAt = args.indexOf("--out");
  const out = resolve(outAt >= 0 && args[outAt + 1] ? args[outAt + 1]! : join(ROOT, "out/architecture-map.html"));
  const d = loadMap();
  const problems = [...shapeProblems(d), ...(noCheck ? [] : citationProblems(d))];
  if (problems.length) {
    console.error(`architecture map: ${problems.length} problem(s)\n${problems.map(p => `  ${p}`).join("\n")}`);
    if (!noCheck) process.exit(1);
  }
  const c = counts(d);
  const ladder = Object.entries(c.ladder).map(([k, v]) => `${k} ${v}`).join(", ");
  if (onlyCheck) {
    console.log(`architecture map: ${c.structures} structures (${ladder}); every citation holds`);
    process.exit(0);
  }
  const html = await render(d, { commits: { door: head(ROOT), outliner: head(OUTLINER) } });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`architecture map: ${out} (${(html.length / 1024).toFixed(0)} KB) · ${c.structures} structures (${ladder}) · ${c.open} open questions, ${c.routed} routed`);
}
