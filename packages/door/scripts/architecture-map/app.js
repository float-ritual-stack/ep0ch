// The architecture map as an isometric walk: chapters build the system up block by block, a trace walks one
// keypress through it, and a click on a block or its row reads it. Plain script over the data the generator
// embeds; it stores nothing (the published page runs on an opaque origin) and keeps its place in the hash.
(() => {
  "use strict";
  const D = JSON.parse(document.getElementById("map-data").textContent);
  const app = document.getElementById("app");
  const NS = "http://www.w3.org/2000/svg";
  const TW = 96, TH = 48;                           // one cell: 2:1 isometric
  const FOOT = [0.33, 0.38, 0.44], TALL = [22, 36, 56];
  const PAL = {
    kept: { top: "#aaaaaa", side: "#555555", dot: "#aaaaaa", ink: "#000000" },
    service: { top: "#5555ff", side: "#0000aa", dot: "#5555ff", ink: "#ffffff" },
    door: { top: "#ff55ff", side: "#aa00aa", dot: "#ff55ff", ink: "#000000" },
    clients: { top: "#55ff55", side: "#00aa00", dot: "#55ff55", ink: "#000000" },
  };
  const LADDER = ["accidental", "recognised", "provisional", "shared", "stable"];
  const S = new Map(D.structures.map(s => [s.id, s]));
  const usedBy = new Map(D.structures.map(s => [s.id, []]));
  for (const s of D.structures) for (const x of s.deps) usedBy.get(x)?.push(s.id);
  const N = D.chapters.length;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const st = { ch: 0, sel: null, tab: "does", trace: -1, findings: false, playing: false, k: 1, tx: 0, ty: 0, user: false, drop: false };
  let timer = null;

  // ── small helpers ──────────────────────────────────────────────────────────────────────────────────────
  const $ = (q, r = document) => r.querySelector(q);
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const svg = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const P = (gx, gy, z = 0) => [(gx - gy) * TW / 2, (gx + gy) * TH / 2 - z];
  const pts = a => a.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const pad2 = n => String(n).padStart(2, "0");
  const shown = s => s.ch <= st.ch || st.trace >= 0;
  const dashed = l => l === "accidental" || l === "recognised" || l === "provisional";
  const openCount = s => s.qs.filter(q => q.status === "open" || q.status === "partial").length;
  const traceIds = new Set(D.trace.steps.map(x => x.at));

  // ── the frame of the page ──────────────────────────────────────────────────────────────────────────────
  const dots = ".".repeat(200);
  const fe = (title, cls = "") => `<div class="fe ${cls}"><span>::</span><span class="lead">....</span>${title ? `<b>${title}</b>` : ""}<span class="fill">${dots}</span><span>::</span></div>`;
  app.innerHTML = `
<header class="bar">
  <div class="brand"><pre class="art2" aria-hidden="true">${$("#logo-art").innerHTML}</pre><div class="word">::.. <b>e p 0 c h</b> ..::</div><div class="sub">architecture map</div><div class="sub">door <b>${esc(D.system.door.commit)}</b> · outliner <b>${esc(D.system.outliner.commit)}</b></div></div>
  <div class="head">
    <div class="stats">
      <div class="stat"><span class="sc">system</span><b>${esc(D.system.door.name)} <small>· ${esc(D.system.door.branch)}</small></b></div>
      <div class="stat"><span class="sc">kept</span><b>${D.counts.kept}</b></div>
      <div class="stat"><span class="sc">built on top</span><b>${D.counts.built}</b></div>
      <div class="stat"><span class="sc">chapter</span><b id="k-ch"></b></div>
      <div class="stat"><span class="sc">structures shown</span><b id="k-shown"></b></div>
      <div class="stat"><span class="sc">open questions</span><b><span class="r">${D.counts.open}</span> <small>open ·</small> ${D.counts.routed} <small>routed</small></b></div>
      ${D.dirty.length ? `<div class="stat dirty" title="${esc(D.dirty.join("\n"))}"><span class="sc">dirty checkout</span><b>${D.dirty.length} <small>${esc(D.dirty.slice(0, 2).join(", "))}${D.dirty.length > 2 ? ", …" : ""}</small></b></div>` : ""}
    </div>
    <div class="ctl">
      <button type="button" class="menu" data-a="list">☰ list</button>
      <button type="button" data-a="back" title="previous chapter (←)">◂ back</button>
      <button type="button" data-a="next" title="next chapter (→)">next ▸</button>
      <button type="button" data-a="play" id="b-play" title="play or pause the chapters (p)"></button>
      <button type="button" data-a="trace" id="b-trace" title="walk the traced action one step (t)">trace one step</button>
      <button type="button" data-a="refit" title="fit the map to the view (f)">refit</button>
      <button type="button" data-a="findings" id="b-find" title="every finding from the three reviews (g)">findings</button>
      <span class="sp"></span>
      <span class="hint">← → chapters · t trace · g findings · esc deselect · wheel/pinch zoom · drag pan</span>
      <button type="button" data-a="text" title="the whole map as one page of text">≡ text</button>
    </div>
  </div>
</header>
<nav class="side" id="side" aria-label="structures"></nav>
<section class="stage">
  <div class="strip">
    <div class="chs" id="chs" role="tablist" aria-label="chapters">${D.chapters.map((c, i) => `<button type="button" data-ch="${i}" title="${esc(c.title)}">${pad2(i + 1)}</button>`).join("")}</div>
    <div class="cht" id="cht"></div>
    <div class="zoom"><button type="button" data-a="out" title="zoom out (-)">−</button><button type="button" data-a="in" title="zoom in (+)">+</button></div>
  </div>
  <div class="view" id="view">
    <pre class="art" aria-hidden="true">${$("#logo-art").innerHTML}</pre>
    <svg id="svg" role="img" aria-label="the system as isometric blocks"><defs id="defs"></defs><g id="world"><g id="g-floor"></g><g id="g-edges"></g><g id="g-blocks"></g><g id="g-trace"></g><g id="g-labels"></g></g></svg>
    <div class="legend2">
      <span class="g-door"><i class="sw ghost"></i>accidental</span>
      <span class="g-door"><i class="sw dash"></i>recognised · provisional</span>
      <span class="g-door"><i class="sw"></i>shared</span>
      <span class="g-door"><i class="sw band"></i>stable</span>
      <span><b style="color:var(--c15);background:var(--c4);font-weight:normal;padding:0 3px">!2</b> open questions</span>
      ${D.groups.map(g => `<span class="g-${g.id}"><i class="sw"></i>${esc(g.name)}</span>`).join("")}
    </div>
    <div class="toast" id="toast"></div>
  </div>
</section>
<aside class="panel" id="panel" aria-live="polite">
  <div class="tabs" role="tablist"><button type="button" data-tab="does">what it does</button><button type="button" data-tab="built">how it's built</button><button type="button" data-tab="qs">open questions</button></div>
  <div class="pb" id="pb"></div>
</aside>`;

  const view = $("#view"), world = $("#world"), defs = $("#defs");
  const G = { floor: $("#g-floor"), edges: $("#g-edges"), blocks: $("#g-blocks"), trace: $("#g-trace"), labels: $("#g-labels") };

  // Hatching as textmode shading: ░ on the lit face, ▒ on the shaded one, in each group's two colours.
  for (const [g, c] of Object.entries(PAL)) {
    const lit = svg("pattern", { id: `lt-${g}`, width: 6, height: 6, patternUnits: "userSpaceOnUse" }, defs);
    svg("rect", { width: 6, height: 6, fill: c.side }, lit);
    svg("rect", { x: 0, y: 0, width: 2, height: 2, fill: c.dot }, lit);
    svg("rect", { x: 3, y: 3, width: 2, height: 2, fill: c.dot }, lit);
    const sh = svg("pattern", { id: `sh-${g}`, width: 4, height: 4, patternUnits: "userSpaceOnUse" }, defs);
    svg("rect", { width: 4, height: 4, fill: "#000000" }, sh);
    svg("rect", { x: 0, y: 0, width: 2, height: 2, fill: c.side }, sh);
    svg("rect", { x: 2, y: 2, width: 2, height: 2, fill: c.side }, sh);
  }

  // ── geometry ───────────────────────────────────────────────────────────────────────────────────────────
  const foot = s => FOOT[s.size];
  const tall = s => TALL[s.size] + (s.ladder === "stable" ? 6 : 0);
  function box(c, r, f, z0, z1) {
    return {
      top: [P(c - f, r - f, z1), P(c + f, r - f, z1), P(c + f, r + f, z1), P(c - f, r + f, z1)],
      right: [P(c + f, r - f, z1), P(c + f, r + f, z1), P(c + f, r + f, z0), P(c + f, r - f, z0)],
      left: [P(c - f, r + f, z1), P(c + f, r + f, z1), P(c + f, r + f, z0), P(c - f, r + f, z0)],
    };
  }
  /** A path on the floor from one structure to another: along the lane, then across it. */
  function floorPath(a, b) {
    const pa = [a.col, a.row], pb = [b.col, b.row];
    const mid = [pb[0], pa[1]];
    return [pa, mid, pb].map(p => P(p[0], p[1]));
  }
  function bounds(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of list) {
      const f = foot(s) + 0.1, h = tall(s) + 20;
      for (const p of [P(s.col - f, s.row - f, h), P(s.col + f, s.row - f, h), P(s.col - f, s.row + f, 0), P(s.col + f, s.row + f, 0)]) {
        x0 = Math.min(x0, p[0] - 12); x1 = Math.max(x1, p[0] + 12); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1] + 30);
      }
    }
    return { x0, y0, x1, y1 };
  }

  // ── the floor: a dotted grid per lane, its name laid on the ground ──────────────────────────────────────
  function drawFloor() {
    G.floor.textContent = "";
    for (const lane of D.lanes) {
      const g = D.groups.find(x => x.id === lane.group), c = PAL[lane.group];
      const r0 = lane.row - 0.5, r1 = lane.row + lane.rows - 0.5, c0 = -0.5, c1 = D.cols - 0.5;
      svg("polygon", { class: "plate", points: pts([P(c0, r0), P(c1, r0), P(c1, r1), P(c0, r1)]), fill: c.side, "fill-opacity": 0.07, stroke: c.top, "stroke-opacity": 0.45 }, G.floor);
      for (let r = lane.row; r < lane.row + lane.rows; r++) for (let k = 0; k < D.cols; k++) {
        svg("polygon", { class: "floor", points: pts([P(k - .5, r - .5), P(k + .5, r - .5), P(k + .5, r + .5), P(k - .5, r + .5)]) }, G.floor);
      }
      // The lane's name painted on the floor at its open end, reading up the lane.
      const [x, y] = P(c0 - 0.22, r1 - 0.08);
      const t = svg("text", { class: "plate-l", transform: `matrix(0.894 -0.447 0.894 0.447 ${x.toFixed(1)} ${y.toFixed(1)})`, fill: c.top, "fill-opacity": 0.8 }, G.floor);
      t.textContent = g.name;
    }
  }

  // ── the blocks ─────────────────────────────────────────────────────────────────────────────────────────
  function drawBlock(s, parent, cls) {
    const c = PAL[s.group], f = foot(s), h = tall(s);
    const g = svg("g", { class: `blk ${cls} l-${s.ladder}`, "data-id": s.id, tabindex: 0, role: "button", "aria-label": `${s.tag} ${s.name}, ${s.ladder}` }, parent);
    svg("title", {}, g).textContent = `${s.tag} ${s.name} · ${s.ladder}`;
    const ghost = s.ladder === "accidental" ? 0.22 : s.ladder === "recognised" ? 0.6 : 1;
    const stroke = dashed(s.ladder) ? c.top : "#000000";
    const dash = dashed(s.ladder) ? "4 3" : null;
    // Slabs: more rests on it, more layers (one to three).
    const n = s.size + 1, gap = 3, sh = (h - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const z0 = i * (sh + gap), z1 = z0 + sh, b = box(s.col, s.row, f, z0, z1);
      svg("polygon", { class: "f left", points: pts(b.left), fill: `url(#sh-${s.group})`, "fill-opacity": ghost, stroke, "stroke-dasharray": dash, "stroke-width": 1 }, g);
      svg("polygon", { class: "f right", points: pts(b.right), fill: `url(#lt-${s.group})`, "fill-opacity": ghost, stroke, "stroke-dasharray": dash, "stroke-width": 1 }, g);
      if (i === n - 1) {
        if (s.ladder === "stable") {
          // Stable: the thick dark band under the lid, a bright hairline on it.
          const band = box(s.col, s.row, f + 0.004, z1 - 12, z1 - 4);
          svg("polygon", { points: pts(band.left), fill: "#000000" }, g);
          svg("polygon", { points: pts(band.right), fill: "#000000" }, g);
          svg("polyline", { points: pts([band.left[0], band.left[1], band.right[1]]), fill: "none", stroke: "#ffffff", "stroke-width": 1 }, g);
        }
        svg("polygon", { class: "f top", points: pts(b.top), fill: c.top, "fill-opacity": s.ladder === "accidental" ? 0.35 : s.ladder === "recognised" ? 0.8 : 1, stroke, "stroke-dasharray": dash, "stroke-width": 1 }, g);
        svg("polygon", { class: "sel-ring", points: pts(box(s.col, s.row, f + 0.07, 0, z1).top) }, g);
        const [x, y] = P(s.col, s.row, z1);
        const t = svg("text", { class: "tagt", "text-anchor": "middle", "dominant-baseline": "central", transform: `matrix(0.894 0.447 -0.894 0.447 ${x.toFixed(1)} ${y.toFixed(1)})`, fill: s.ladder === "accidental" ? c.top : c.ink }, g);
        t.textContent = s.tag;
      }
    }
    return g;
  }
  function marker(s, parent, text, gap) {
    const f = foot(s), [x, y] = P(s.col + f, s.row - f, tall(s));
    const g = svg("g", { class: `mk${gap ? " gap" : ""}`, transform: `translate(${x.toFixed(1)} ${(y - 6).toFixed(1)})` }, parent);
    const w = text.length * 5.6 + 5;
    svg("rect", { x: -w / 2, y: -7, width: w, height: 12 }, g);
    const t = svg("text", { "text-anchor": "middle", y: 2.5 }, g);
    t.textContent = text;
  }
  let taken = [];
  function label(s, parent) {
    const f = foot(s), [x, y] = P(s.col + f, s.row + f, 0);
    const name = s.name.length > 26 ? s.name.slice(0, 25) + "…" : s.name;
    const w = name.length * 6.6 + 10;
    // A label that would sit on one already drawn is left off; the block's tooltip has it, and selecting it draws it.
    const r = { x0: x - w / 2 - 2, x1: x + w / 2 + 2, y0: y + 6, y1: y + 26 };
    if (taken.some(t => r.x0 < t.x1 && t.x0 < r.x1 && r.y0 < t.y1 && t.y0 < r.y1)) return;
    taken.push(r);
    const g = svg("g", { class: "lbl", transform: `translate(${x.toFixed(1)} ${(y + 8).toFixed(1)})` }, parent);
    svg("rect", { x: -w / 2, y: 0, width: w, height: 16, stroke: PAL[s.group].top, "stroke-dasharray": dashed(s.ladder) ? "3 2" : null }, g);
    const t = svg("text", { "text-anchor": "middle", y: 12 }, g);
    t.textContent = name;
  }

  // ── drawing the state ──────────────────────────────────────────────────────────────────────────────────
  function drawMap() {
    const step = st.trace >= 0 ? D.trace.steps[st.trace] : null;
    const sel = st.sel && S.get(st.sel);
    const vis = D.structures.filter(shown);
    const visSet = new Set(vis.map(s => s.id));
    const near = new Set();
    if (sel) { near.add(sel.id); for (const x of sel.deps) near.add(x); for (const x of usedBy.get(sel.id)) near.add(x); }
    // Edges: what each shown structure rests on.
    G.edges.textContent = "";
    for (const s of vis) for (const x of s.deps) {
      if (!visSet.has(x)) continue;
      const a = S.get(x);
      let cls = "edge";
      if (sel) cls += s.id === sel.id ? " up" : x === sel.id ? " down" : " dim";
      else if (step) cls += " dim";
      svg("polyline", { class: cls, points: pts(floorPath(a, s)) }, G.edges);
    }
    missing = null;
    // The gap made visible: the key that should reach the registry and doesn't.
    const gapFrom = D.trace.steps.find(x => x.gap);
    if (gapFrom && ((step && step.gap) || (sel && sel.id === gapFrom.at)) && visSet.has(gapFrom.at) && visSet.has("door.actions")) {
      missing = floorPath(S.get(gapFrom.at), S.get("door.actions")).map(p => [p[0], p[1] - 8]);
    }
    // Blocks, back to front; later chapters as dotted footprints.
    G.blocks.textContent = ""; G.labels.textContent = "";
    const order = [...D.structures].sort((a, b) => (a.col + a.row) - (b.col + b.row) || a.col - b.col);
    let delay = 0;
    const want = [];
    const onTrace = new Set(step ? D.trace.steps.slice(0, st.trace + 1).map(x => x.at) : []);
    for (const s of order) {
      if (!shown(s)) {
        const f = foot(s);
        svg("polygon", { class: "foot", points: pts(box(s.col, s.row, f, 0, 0).top) }, G.blocks);
        continue;
      }
      const isNew = s.ch === st.ch && st.trace < 0;
      let cls = "";
      if (isNew && st.drop && !reduced) cls += " new";
      if (sel && s.id === sel.id) cls += " sel";
      if (step && s.id === step.at) cls += " at";
      if ((sel && !near.has(s.id)) || (step && !onTrace.has(s.id))) cls += " dim";
      const g = drawBlock(s, G.blocks, cls);
      if (cls.includes(" new")) { g.style.setProperty("--d", (delay * 0.07).toFixed(2) + "s"); delay++; }
      const open = openCount(s);
      if (step && step.gap && s.id === step.at) marker(s, g, "GAP", true);
      else if (open) marker(s, g, "!" + open, false);
      const rank = (sel && s.id === sel.id) || (step && s.id === step.at) ? 3 : sel && near.has(s.id) ? 2 : isNew ? 1 : st.k >= 1.35 || (!sel && !step && st.ch === N - 1 && s.size === 2) ? 0 : -1;
      if (rank >= 0) want.push([rank, s]);
    }
    taken = [];
    want.sort((a, b) => b[0] - a[0] || (b[1].col + b[1].row) - (a[1].col + a[1].row));
    for (const [, s] of want) label(s, G.labels);
    drawTrace();
  }

  // ── the trace: a dot along the floor, one step per press ───────────────────────────────────────────────
  let anim = 0, missing = null;
  function drawTrace() {
    cancelAnimationFrame(anim);
    G.trace.textContent = "";
    // Drawn over the blocks: the road the key should take, into the registry, and doesn't.
    if (missing) {
      svg("polyline", { class: "edge miss", points: pts(missing) }, G.trace);
      const [x, y] = missing[missing.length - 1];
      const g = svg("g", { class: "tr-tag gap", transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, G.trace);
      svg("rect", { x: -60, y: -30, width: 120, height: 17 }, g);
      svg("text", { x: -55, y: -18 }, g).textContent = "no ActionDef here";
    }
    if (st.trace < 0) return;
    const steps = D.trace.steps;
    for (let i = 1; i <= st.trace; i++) {
      const a = S.get(steps[i - 1].at), b = S.get(steps[i].at);
      if (a !== b && i < st.trace) svg("polyline", { class: "tr-past", points: pts(floorPath(a, b)) }, G.trace);
    }
    const cur = steps[st.trace], b = S.get(cur.at);
    let path;
    if (st.trace === 0) {
      // The person's key comes in from the front of the map: a keycap beside the block.
      const kc = { col: b.col - 1.1, row: b.row + 1.25 };
      const cap = svg("g", { class: "keycap" }, G.trace);
      const bx = box(kc.col, kc.row, 0.2, 0, 10);
      svg("polygon", { points: pts(bx.left), fill: "#555555", stroke: "#000" }, cap);
      svg("polygon", { points: pts(bx.right), fill: "#aaaaaa", stroke: "#000" }, cap);
      svg("polygon", { points: pts(bx.top), fill: "#ffffff", stroke: "#000" }, cap);
      const [x, y] = P(kc.col, kc.row, 10);
      const t = svg("text", { class: "kt", "text-anchor": "middle", "dominant-baseline": "central", transform: `matrix(0.894 0.447 -0.894 0.447 ${x} ${y})` }, cap);
      t.textContent = "m";
      path = floorPath(kc, b);
    } else {
      const a = S.get(steps[st.trace - 1].at);
      path = a === b ? (() => { const [x, y] = P(b.col, b.row); return [[x - 26, y + 13], [x, y + 26], [x + 26, y + 13], [x, y]]; })() : floorPath(a, b);
    }
    const lift = p => [p[0], p[1] - 6];
    path = path.map(lift);
    svg("polyline", { class: `tr-path${cur.gap ? " gap" : ""}`, points: pts(path) }, G.trace);
    const dot = svg("circle", { class: "tr-dot", r: 6 }, G.trace);
    const tag = svg("g", { class: `tr-tag${cur.gap ? " gap" : ""}` }, G.trace);
    const text = `${pad2(st.trace + 1)} ${cur.label}`;
    const w = text.length * 6.8 + 10;
    svg("rect", { x: 10, y: 8, width: w, height: 17 }, tag);
    const tt = svg("text", { x: 15, y: 20 }, tag);
    tt.textContent = text;
    // Walk the polyline over ~0.9s.
    const seg = [];
    let total = 0;
    for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(l); total += l; }
    const at = u => {
      let d = u * total;
      for (let i = 0; i < seg.length; i++) {
        if (d <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, d / seg[i]) : 1; return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k]; }
        d -= seg[i];
      }
      return path[path.length - 1];
    };
    const put = u => { const [x, y] = at(u); dot.setAttribute("cx", x.toFixed(1)); dot.setAttribute("cy", y.toFixed(1)); tag.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`); };
    if (reduced || !total) { put(1); return; }
    const t0 = performance.now();
    const tick = now => { const u = Math.min(1, (now - t0) / 900); put(1 - Math.pow(1 - u, 3)); if (u < 1) anim = requestAnimationFrame(tick); };
    put(0); anim = requestAnimationFrame(tick);
  }

  // ── the list down the side ─────────────────────────────────────────────────────────────────────────────
  function drawSide() {
    const step = st.trace >= 0 ? D.trace.steps[st.trace] : null;
    $("#side").innerHTML = D.groups.map(g => {
      const items = D.structures.filter(s => s.group === g.id).map(s => {
        const later = !shown(s), open = openCount(s);
        const cls = ["item", `g-${s.group}`, dashed(s.ladder) ? "dash" : "", later ? "later" : "", s.ch === st.ch && st.trace < 0 ? "new" : "",
          st.sel === s.id ? "sel" : "", step && step.at === s.id ? "intrace" : ""].filter(Boolean).join(" ");
        const n = later ? `CH ${pad2(s.ch + 1)}` : open ? `!${open}` : `${s.refs.length}↗`;
        return `<button type="button" class="${cls}" data-id="${esc(s.id)}" title="${esc(s.ladder)}${later ? ", from chapter " + (s.ch + 1) : ""}"><span class="tg">${esc(s.tag)}</span><span class="nm">${esc(s.name)}</span><span class="n${!later && open ? " q" : ""}">${n}</span></button>`;
      }).join("");
      return `<div class="lane g-${g.id}">${fe(`${esc(g.name)} — ${esc(g.motto)}`)}<div class="motto">${esc(g.about)}</div>${items}</div>`;
    }).join("");
  }

  // ── the panel ──────────────────────────────────────────────────────────────────────────────────────────
  const statusCls = s => "st-" + s.replace(" ", "-");
  const chip = id => { const s = S.get(id); return `<button type="button" class="chip2 g-${s.group}${dashed(s.ladder) ? " dash" : ""}" data-id="${esc(id)}">${esc(s.tag)} ${esc(s.name)}</button>`; };
  function ladderTag(s) {
    return `<span class="ltag l-${s.ladder}${dashed(s.ladder) ? " dash" : ""}">${s.was && s.was !== s.ladder ? `<s>${esc(s.was)}</s> → ` : ""}${esc(s.ladder)}</span>`;
  }
  function refItem(r, hl) {
    return `<li${hl ? ' class="hl"' : ""}><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a><span class="m">${esc(r.m)}</span></li>`;
  }
  function panelStructure(s) {
    const isNew = s.ch === st.ch;
    const open = openCount(s);
    const tabs = {
      does: `<p>${s.does}</p>
${s.tree ? `<p><span class="ltag ${s.tree === "on" ? "l-shared" : s.tree === "own" ? "l-recognised dash" : "l-accidental dash"}">${s.tree === "on" ? "a preset on the layout tree" : s.tree === "own" ? "its own tree host" : "outside the layout tree"}</span></p>` : ""}
${s.deps.length ? `<h4>rests on</h4><div class="chips2">${s.deps.map(chip).join("")}</div>` : ""}
${usedBy.get(s.id).length ? `<h4>rested on by</h4><div class="chips2">${usedBy.get(s.id).map(chip).join("")}</div>` : ""}
${traceIds.has(s.id) ? `<h4>in the trace</h4><p>${D.trace.steps.map((x, i) => x.at === s.id ? `<button type="button" class="chip2 g-${s.group}" data-step="${i}">${pad2(i + 1)} ${esc(x.label)}</button>` : "").join(" ")}</p>` : ""}
<h4>read more</h4><ul class="refl">${s.refs.slice(0, 2).map(r => refItem(r)).join("")}</ul>`,
      built: `<p>${s.built}</p><h4>where it's built · ${s.refs.length} citation${s.refs.length === 1 ? "" : "s"}, each checked</h4><ul class="refl">${s.refs.map(r => refItem(r)).join("")}</ul>`,
      qs: s.qs.length ? `<ul class="qs2">${s.qs.map(q => `<li><span class="st ${statusCls(q.status)}">${esc(q.status)}</span>${q.text}<span class="meta">${q.finding ? `<a class="fid" href="${esc(q.finding.url)}" target="_blank" rel="noopener" title="${esc(q.finding.title)}">${esc(q.finding.id)}</a> <a class="then" href="${esc(q.finding.then.door)}" target="_blank" rel="noopener" title="what the review read: door ${esc(q.finding.then.label)}">then ${esc(q.finding.then.label.split(" · ")[0])}</a> ` : ""}${q.route ? `<span class="rt" title="${esc(q.routeAbout)}">→ ${esc(q.route)}</span> <span style="color:var(--c8)">${esc(q.routeAbout)}</span>` : `<span class="rt none">not routed</span>`}</span></li>`).join("")}</ul>` : `<p style="color:var(--c8)">No open questions on this one.</p>`,
    };
    return `<div class="kick g-${s.group} l-${s.ladder}">${esc(s.tag)} · <span class="l">${esc(s.ladder)}</span> · ${isNew ? `<span class="nw">new in this chapter</span>` : `chapter ${pad2(s.ch + 1)}`}</div>
<h2 class="pt">${esc(s.name)}</h2>
<div><span class="gtag g-${s.group}">${esc(s.group)}</span>${ladderTag(s)}${open ? `<span class="ltag l-accidental">${open} open</span>` : ""}</div>
${tabs[st.tab]}
<button type="button" class="back" data-a="deselect">◂ back to chapter</button>`;
  }
  function panelChapter() {
    const c = D.chapters[st.ch];
    const here = D.structures.filter(s => s.ch === st.ch);
    const ladder = D.ladder.map(l => `<li class="l-${l.id}"><span class="ltag l-${l.id}${dashed(l.id) ? " dash" : ""}">${l.id}</span><b style="color:var(--c15);font-weight:normal">${D.structures.filter(s => shown(s) && s.ladder === l.id).length}</b><span class="d">${esc(l.about)}</span></li>`).join("");
    return `<div class="kick">chapter ${pad2(st.ch + 1)} of ${N}</div>
<h2 class="pt">${esc(c.title)}</h2>
<p class="lede2">${c.lede}</p>
<h4>new in this chapter · ${here.length}</h4><div class="chips2">${here.map(s => chip(s.id)).join("")}</div>
<h4>the ladder, so far</h4><ul class="laddr">${ladder}</ul>
${st.ch === N - 1 ? `<h4>since the three reviews</h4><p>${D.counts.resolved} findings resolved, ${D.counts.moved} structures moved up the ladder. ${D.counts.open} questions still open, ${D.counts.routed} of them routed.</p>` : ""}
<h4>the trace</h4><p>${D.trace.about}</p><button type="button" data-a="trace">trace one step ▸</button>`;
  }
  function panelTrace() {
    const steps = D.trace.steps, cur = steps[st.trace], s = S.get(cur.at);
    return `<div class="kick">trace · ${esc(D.trace.title)} · step ${pad2(st.trace + 1)}/${steps.length}</div>
<h2 class="pt">${esc(cur.label)}</h2>
<div><button type="button" class="chip2 g-${s.group}${dashed(s.ladder) ? " dash" : ""}" data-id="${esc(s.id)}">${esc(s.tag)} ${esc(s.name)}</button></div>
<p>${cur.what}</p>
${cur.gap ? `<div class="gapbox"><b>GAP</b>The key is matched in place: it doesn't go through an ActionDef, so an agent's <code>act card.move</code> and the person's <code>m</code> take different roads to the same <code>moveTo</code>. ${D.gapRoute ? `Routed: <span class="rt">→ ${esc(D.gapRoute)}</span>.` : ""}</div>` : ""}
<div class="bigref"><a href="${esc(cur.ref.url)}" target="_blank" rel="noopener">${esc(cur.ref.label)}</a><span class="m">${esc(cur.ref.m)}</span></div>
<div class="trnav"><button type="button" data-a="tprev">◂ step</button><button type="button" data-a="trace">step ▸</button><button type="button" data-a="tend">end trace</button></div>
<ol class="steps">${steps.map((x, i) => `<li><button type="button" data-step="${i}" class="${i === st.trace ? "on" : i < st.trace ? "done" : ""}"><span>${pad2(i + 1)}</span><span>${esc(x.label)} <span style="color:var(--c8)">· ${esc(S.get(x.at).tag)}</span></span>${x.gap ? '<span class="g">gap</span>' : "<span></span>"}</button></li>`).join("")}</ol>`;
  }
  const FGROUP = { open: 0, partial: 1, resolved: 2, "no action": 3 };
  function panelFindings() {
    const rows = D.reviews.map(r => {
      const fs = D.findings.filter(f => f.id.startsWith(r.id + "-")).sort((a, b) => FGROUP[a.status] - FGROUP[b.status]);
      const open = fs.filter(f => f.status === "open" || f.status === "partial").length;
      return `<h4>review ${esc(r.id)} · ${esc(r.name)} · ${fs.length} findings, ${open} open</h4>
<p class="thennow">then <a href="${esc(r.then.door)}" target="_blank" rel="noopener">door ${esc(r.then.label.split(" · ")[0])}</a> <a href="${esc(r.then.outliner)}" target="_blank" rel="noopener">outliner ${esc(r.then.label.split(" · ")[1])}</a> · now <a href="${esc(D.now.door)}" target="_blank" rel="noopener">door ${esc(D.now.label.split(" · ")[0])}</a> <a href="${esc(D.now.outliner)}" target="_blank" rel="noopener">outliner ${esc(D.now.label.split(" · ")[1])}</a></p>
<ul class="qs2">${fs.map(f => `<li id="f-${esc(f.id)}"><span class="st ${statusCls(f.status)}">${esc(f.status)}</span><a class="fid" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.id)}</a> ${f.title}${f.note ? `<span class="meta" style="color:var(--c8)">${f.note}</span>` : ""}<span class="meta">${f.at.map(chip).join(" ")} ${f.by ? `<span style="color:var(--c8)">by ${esc(f.by)}</span> ` : ""}${f.route ? `<span class="rt" title="${esc(D.routes[f.route] || "")}">→ ${esc(f.route)}</span>` : f.status === "open" || f.status === "partial" ? `<span class="rt none">not routed</span>` : ""}</span></li>`).join("")}</ul>`;
    }).join("");
    return `<div class="kick">the findings, then and now</div>
<h2 class="pt">${D.findings.length} findings</h2>
<p>${D.counts.resolved} resolved since the three reviews; ${D.counts.open} open or partial, ${D.counts.routed} of them routed. A block's chip goes to the block; an id goes to the finding in its review.</p>
${rows}
<button type="button" class="back" data-a="findings">◂ back to chapter</button>`;
  }
  function drawPanel() {
    const s = st.sel && S.get(st.sel);
    const tabs = [...document.querySelectorAll(".tabs button")];
    for (const b of tabs) {
      b.disabled = !s;
      b.classList.toggle("on", !!s && b.dataset.tab === st.tab);
      if (b.dataset.tab === "qs") b.textContent = s && openCount(s) ? `open questions · ${openCount(s)}` : "open questions";
    }
    $("#pb").innerHTML = s ? panelStructure(s) : st.findings ? panelFindings() : st.trace >= 0 ? panelTrace() : panelChapter();
    $("#b-find").classList.toggle("hot", st.findings);
  }

  function drawBar() {
    $("#k-ch").innerHTML = st.trace >= 0 ? `<i>trace</i> <small>${pad2(st.trace + 1)}/${D.trace.steps.length}</small>` : `${st.ch + 1}<small>/${N}</small>`;
    $("#k-shown").innerHTML = `${D.structures.filter(shown).length}<small>/${D.structures.length}</small>`;
    $("#cht").innerHTML = st.trace >= 0 ? `<i>trace</i> · ${esc(D.trace.title)}` : `<i>chapter ${st.ch + 1}</i> · ${esc(D.chapters[st.ch].title)}`;
    for (const b of document.querySelectorAll("#chs button")) {
      const i = +b.dataset.ch;
      b.classList.toggle("on", i === st.ch && st.trace < 0);
      b.classList.toggle("past", i < st.ch && st.trace < 0);
    }
    $("#b-play").textContent = st.playing ? "⏸ pause" : "▶ play";
    $("#b-play").classList.toggle("hot", st.playing);
    $("#b-trace").classList.toggle("hot", st.trace >= 0);
  }

  function draw() {
    drawBar(); drawMap(); drawSide(); drawPanel();
    st.drop = false;
    saveHash();
  }

  // ── the camera ─────────────────────────────────────────────────────────────────────────────────────────
  function apply(smooth) {
    world.style.transition = smooth && !reduced ? "transform .6s cubic-bezier(.3,.8,.3,1)" : "none";
    world.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.k})`;
  }
  function refit(smooth = true) {
    // The whole floor, always: blocks appear on it chapter by chapter while the camera stays put.
    const tgt = bounds(D.structures);
    // Room for the lanes' names painted at their open ends.
    for (const lane of D.lanes) { const [x] = P(-0.5, lane.row + lane.rows); tgt.x0 = Math.min(tgt.x0, x); }
    const w = view.clientWidth || 800, h = view.clientHeight || 500;
    const k = Math.max(0.2, Math.min(1.6, Math.min((w - 16) / (tgt.x1 - tgt.x0), (h - 48) / (tgt.y1 - tgt.y0))));
    st.k = k;
    st.tx = w / 2 - k * (tgt.x0 + tgt.x1) / 2;
    st.ty = (h - 20) / 2 - k * (tgt.y0 + tgt.y1) / 2 + (phone() ? 0 : Math.min(40, h * 0.05));
    st.user = false;
    apply(smooth);
  }
  function zoomAt(f, cx, cy, smooth) {
    const k = Math.max(0.2, Math.min(4, st.k * f));
    const r = k / st.k;
    st.tx = cx - (cx - st.tx) * r; st.ty = cy - (cy - st.ty) * r; st.k = k; st.user = true;
    apply(smooth);
    labelsForZoom();
  }
  let lastLabelZoom = false;
  function labelsForZoom() { const z = st.k >= 1.35; if (z !== lastLabelZoom) { lastLabelZoom = z; drawMap(); } }

  // ── moving through it ──────────────────────────────────────────────────────────────────────────────────
  function toast(t) { const e = $("#toast"); e.textContent = t; clearTimeout(toast.t); toast.t = setTimeout(() => { e.textContent = ""; }, 2200); }
  function go(ch, opts = {}) {
    ch = Math.max(0, Math.min(N - 1, ch));
    const changed = ch !== st.ch || st.trace >= 0;
    st.ch = ch; st.trace = -1; st.findings = false;
    if (!opts.keepSel && st.sel && S.get(st.sel).ch > ch) st.sel = null;
    st.drop = changed;
    draw();
    if (!st.user) refit(true);
  }
  function play(on) {
    st.playing = on;
    clearInterval(timer); timer = null;
    if (on) {
      if (st.ch >= N - 1 || st.trace >= 0) go(0);
      timer = setInterval(() => { if (st.ch >= N - 1) play(false); else go(st.ch + 1); }, 5200);
    }
    drawBar();
  }
  const stop = () => { if (st.playing) play(false); };
  function select(id, tab, from) {
    if (id && !S.has(id)) return;
    st.sel = id; if (tab) st.tab = tab; else if (id) st.tab = "does";
    if (id && !shown(S.get(id))) { st.ch = S.get(id).ch; st.drop = true; }
    draw();
    if (id && phone()) {
      if (from === "map") toast(`${S.get(id).tag} · read it below ↓`);
      else { app.classList.remove("list"); view.scrollIntoView({ block: "start" }); }
    }
  }
  const phone = () => matchMedia("(max-width:760px)").matches;
  function trace(i) {
    const n = D.trace.steps.length;
    const wasOff = st.trace < 0;
    st.trace = ((i % n) + n) % n; st.sel = null; st.findings = false;
    draw();
    if (wasOff && !st.user) refit(true);
  }
  function endTrace() { st.trace = -1; draw(); if (!st.user) refit(true); }

  // Keep the place in the hash (#ch5, #ch5/door.keys, #trace3) so a link opens where it was sent from.
  function saveHash() {
    const h = st.sel ? `#ch${st.ch + 1}/${st.sel}` : st.findings ? "#findings" : st.trace >= 0 ? `#trace${st.trace + 1}` : `#ch${st.ch + 1}`;
    try { if (location.hash !== h) history.replaceState(null, "", h); } catch { /* an opaque origin may refuse; the map works without it */ }
  }
  function readHash() {
    const h = decodeURIComponent(location.hash || "");
    let m;
    // The text page's anchors too, so an old link lands on the same thing here.
    if (h === "#findings") { st.ch = N - 1; st.findings = true; return true; }
    if ((m = /^#f-([A-C]-F\d+)$/.exec(h))) { st.ch = N - 1; st.findings = true; return true; }
    if (h === "#trace" || /^#t-\d+$/.test(h)) { st.ch = N - 1; st.trace = h === "#trace" ? 0 : Math.max(0, Math.min(D.trace.steps.length - 1, +h.slice(3) - 1)); return true; }
    if ((m = /^#ch-(\d+)$/.exec(h))) { st.ch = Math.max(0, Math.min(N - 1, +m[1] - 1)); return true; }
    if ((m = /^#trace(\d+)$/.exec(h))) { st.ch = N - 1; st.trace = Math.max(0, Math.min(D.trace.steps.length - 1, +m[1] - 1)); return true; }
    if ((m = /^#ch(\d+)(?:\/(.+))?$/.exec(h))) {
      st.ch = Math.max(0, Math.min(N - 1, +m[1] - 1));
      if (m[2] && S.has(m[2])) { st.sel = m[2]; if (S.get(m[2]).ch > st.ch) st.ch = S.get(m[2]).ch; }
      return true;
    }
    if ((m = /^#s-(.+)$/.exec(h))) { const id = [...S.keys()].find(k => "s-" + k.replace(/\./g, "-") === h.slice(1)); if (id) { st.sel = id; st.ch = S.get(id).ch; return true; } }
    return false;
  }

  function act(a) {
    switch (a) {
      case "back": stop(); if (st.trace >= 0) trace(st.trace - 1); else go(st.ch - 1); break;
      case "next": stop(); if (st.trace >= 0) trace(st.trace + 1); else go(st.ch + 1); break;
      case "play": play(!st.playing); break;
      case "trace": stop(); trace(st.trace + 1); break;
      case "tprev": stop(); trace(st.trace - 1); break;
      case "tend": endTrace(); break;
      case "refit": refit(true); drawMap(); break;
      case "in": zoomAt(1.25, view.clientWidth / 2, view.clientHeight / 2, true); break;
      case "out": zoomAt(0.8, view.clientWidth / 2, view.clientHeight / 2, true); break;
      case "deselect": select(null); break;
      case "list": app.classList.toggle("list"); break;
      case "findings": stop(); st.findings = !st.findings; if (st.findings) { st.sel = null; st.trace = -1; st.drop = st.ch !== N - 1; st.ch = N - 1; } draw(); $("#panel").scrollTop = 0; if (st.findings) $("#panel").scrollIntoView?.({ block: "nearest" }); break;
      case "text": stop(); document.documentElement.classList.add("text"); scrollTo(0, 0); break;
    }
  }

  // Clicks: one handler for the bar, the list, the panel and the blocks.
  app.addEventListener("click", e => {
    const t = e.target.closest("[data-a],[data-ch],[data-id],[data-tab],[data-step]");
    if (!t || (t.closest("#view") && dragged)) return;
    if (t.dataset.a) return act(t.dataset.a);
    if (t.dataset.ch !== undefined) { stop(); return go(+t.dataset.ch, { keepSel: true }); }
    if (t.dataset.tab) { if (st.sel) { st.tab = t.dataset.tab; drawPanel(); } return; }
    if (t.dataset.step !== undefined) { stop(); return trace(+t.dataset.step); }
    if (t.dataset.id) { stop(); if (st.trace >= 0 && !t.closest(".panel")) st.trace = -1; return select(st.sel === t.dataset.id && t.closest("#view") ? null : t.dataset.id, undefined, t.closest("#view") ? "map" : "list"); }
  });
  $("#view").addEventListener("keydown", e => {
    const b = e.target.closest?.(".blk");
    if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); stop(); select(b.dataset.id, undefined, "map"); }
  });
  document.getElementById("totext")?.addEventListener("click", () => { document.documentElement.classList.remove("text"); refit(false); });

  document.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey || /input|textarea|select/i.test(e.target.tagName)) return;
    if (document.documentElement.classList.contains("text")) return;
    const k = e.key;
    if (k === "ArrowRight") act("next");
    else if (k === "ArrowLeft") act("back");
    else if (k === "t") act("trace");
    else if (k === "T") act("tprev");
    else if (k === "Escape") { stop(); if (st.sel) select(null); else if (st.trace >= 0) endTrace(); else return; }
    else if (k === "p" || (k === " " && !e.target.closest("button,.blk"))) act("play");
    else if (k === "+" || k === "=") act("in");
    else if (k === "-" || k === "_") act("out");
    else if (k === "f") act("refit");
    else if (k === "g") act("findings");
    else if (/^[0-9]$/.test(k)) { stop(); go(k === "0" ? 9 : +k - 1); }
    else return;
    e.preventDefault();
  });

  // Pan with a drag, zoom with the wheel or a pinch, around the pointer.
  const ptrs = new Map();
  let dragged = false, down = null, pinch = null;
  view.addEventListener("pointerdown", e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { down = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty }; dragged = false; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: st.k }; }
  });
  view.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = view.getBoundingClientRect();
    if (ptrs.size >= 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      zoomAt((pinch.k * d / pinch.d) / st.k, cx, cy, false);
      dragged = true;
      return;
    }
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragged && Math.hypot(dx, dy) > 5) { dragged = true; view.classList.add("drag"); try { view.setPointerCapture(e.pointerId); } catch { /* fine */ } stop(); }
      if (dragged) { st.tx = down.tx + dx; st.ty = down.ty + dy; st.user = true; apply(false); }
    }
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!ptrs.size) { down = null; view.classList.remove("drag"); setTimeout(() => { dragged = false; }, 0); }
  };
  view.addEventListener("pointerup", up);
  view.addEventListener("pointercancel", up);
  view.addEventListener("wheel", e => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    // A trackpad pinch arrives as a ctrl+wheel with small deltas; a mouse wheel as big steps. Both feel like one notch.
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018));
    zoomAt(f, e.clientX - r.left, e.clientY - r.top, false);
  }, { passive: false });
  let rz = 0;
  addEventListener("resize", () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (!st.user) refit(false); }); });

  // ── start ──────────────────────────────────────────────────────────────────────────────────────────────
  drawFloor();
  const linked = readHash();
  st.drop = true;
  draw();
  refit(false);
  if (!linked && !reduced) play(true);
  // Test hook for the screenshot script: nothing on the page uses it.
  window.__map = { st, go, select, trace, refit, act };
})();
