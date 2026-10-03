// ep0ch docs: the behaviour every page shares. Each part works without the others; with no script at all a page
// still reads in full (the cast shows its poster frame and its chapter list, code is selectable).
(() => {
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  // calm ↔ night: both the door's dark themes (the head sets the saved one before anything paints).
  for (const b of document.querySelectorAll("[data-tone-toggle]")) {
    const show = () => { b.textContent = document.documentElement.dataset.tone === "night" ? "night" : "calm"; b.title = `theme: ${b.textContent} (click for ${b.textContent === "night" ? "calm" : "night"})`; };
    show();
    b.addEventListener("click", () => {
      const night = document.documentElement.dataset.tone !== "night";
      if (night) document.documentElement.dataset.tone = "night"; else delete document.documentElement.dataset.tone;
      store.set("ep0ch-docs-tone", night ? "night" : null);
      show();
    });
  }

  // Copy: the code exactly as shown (a diff copies its result: added and context lines, never removed ones).
  for (const btn of document.querySelectorAll(".code .copy")) {
    btn.addEventListener("click", async () => {
      const pre = btn.closest(".code").querySelector("pre");
      const text = pre.classList.contains("diff")
        ? [...pre.querySelectorAll(".add, .ctx")].map(l => l.textContent).join("\n")
        : pre.textContent;
      const done = label => { btn.dataset.state = label === "copied" ? "done" : ""; btn.textContent = label; setTimeout(() => { btn.textContent = "copy"; btn.dataset.state = ""; }, 1600); };
      try { await navigator.clipboard.writeText(text.replace(/\n$/, "")); done("copied"); }
      catch { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); done("selected: ⌘C"); }
    });
  }

  // Try it: tick a step off; remembered for this page in this browser only.
  for (const list of document.querySelectorAll("ol.try")) {
    const key = `ep0ch-docs-try:${location.pathname}:${list.id}`;
    const done = new Set((store.get(key) || "").split(",").filter(Boolean));
    [...list.children].forEach((li, i) => {
      const box = li.querySelector(".box");
      const paint = () => { li.toggleAttribute("data-done", done.has(String(i))); box.setAttribute("aria-pressed", done.has(String(i))); };
      paint();
      box.addEventListener("click", () => { done.has(String(i)) ? done.delete(String(i)) : done.add(String(i)); store.set(key, [...done].join(",") || null); paint(); });
    });
  }

  // Casts: asciinema-player on a .cast whose `m` events are the chapters. The list on the page is drawn from the
  // cast's own markers once it loads, so a re-recorded tour can't leave stale chapters behind.
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  for (const fig of document.querySelectorAll("figure.cast[data-cast]")) {
    const screen = fig.querySelector(".cast-screen"), list = fig.querySelector(".chapters");
    const src = new URL(fig.dataset.cast, location.href).href;
    fetch(src).then(r => r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${src}`))).then(text => {
      const lines = text.trim().split("\n"), head = JSON.parse(lines[0]);
      const marks = lines.slice(1).map(l => JSON.parse(l)).filter(e => e[1] === "m").map(([t, , label]) => ({ t, label }));
      const end = lines.length > 1 ? JSON.parse(lines[lines.length - 1])[0] : 0;
      if (!window.AsciinemaPlayer) return;   // no player: the poster and the static list stand
      list.replaceChildren(...marks.map((m, i) => {
        const li = document.createElement("li"), b = document.createElement("button"), t = document.createElement("span");
        t.className = "t"; t.textContent = clock(m.t);
        b.type = "button"; b.dataset.i = i; b.append(m.label, t);
        li.append(b);
        return li;
      }));
      const total = fig.querySelector("[data-cast-length]");
      if (total) total.textContent = `${clock(end + 3)} · ${marks.length} chapters`;
      screen.replaceChildren();
      const player = AsciinemaPlayer.create({ data: text }, screen, {
        cols: head.width, rows: head.height, fit: "width", theme: "ep0ch", idleTimeLimit: 2,
        terminalFontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
        poster: "npt:0:0.5", preload: true,
      });
      const items = [...list.children];
      const mark = i => items.forEach((li, j) => j === i ? li.setAttribute("aria-current", "step") : li.removeAttribute("aria-current"));
      const at = s => { let i = 0; marks.forEach((m, j) => { if (s + 0.05 >= m.t) i = j; }); return i; };
      mark(0);
      list.addEventListener("click", async e => {
        const b = e.target.closest("button[data-i]");
        if (!b) return;
        const i = +b.dataset.i;
        await player.seek({ marker: i }); mark(i); player.play();
      });
      player.addEventListener("marker", ({ index }) => mark(index));
      setInterval(async () => { const s = await player.getCurrentTime(); if (typeof s === "number") mark(at(s)); }, 300);
    }).catch(err => {
      const note = document.createElement("p");
      note.className = "cast-foot"; note.textContent = `The recording didn't load (${err.message}). Its first frame and chapters are above; run the showcase section to see it live.`;
      fig.append(note);
    });
  }
})();
