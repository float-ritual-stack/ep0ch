// The tailnet web client's reader (PIE-774, PIE-782): marginalia on a note's page. Served by the publisher at
// `<base>/_marginalia/reader.js`, the only script its pages run (publish.ts READER_CSP), on tailnet pages only.
//
// - Select words in the note: a toolbar along the bottom (a thumb reaches it, and it never covers the phone's own
//   selection menu) offers what the page's threads route says it can: Highlight, Comment, Ask, Copy, Explain, …
// - Comment and Ask open a sheet to write in; what's written stays in it until the outline has it (a refusal keeps
//   the text, says why, and Send tries again with the same request id, so a retry never writes twice).
// - Threads are cards: beside the text when the window is wide, under their passage when it's narrow, with Reply and
//   Resolve. A highlight alone has no card until its words are tapped.
// - The page waits on the threads route for the next change (a long poll), so an answer lands on the page soon after
//   it lands in the outline; the note itself is fetched again then, so new marks show.
// - Opening a thread marks it read (the `/replies` page's unread marks clear): arriving at `#thread=<id>` from Recent
//   replies (its card opens and comes into view), tapping its words, or replying in it.
//
// Dark throughout, no animation, nothing that flashes (Evan is photosensitive). Plain DOM, no build, no eval: text is
// set as text, never as HTML.
(() => {
  "use strict";
  const main = document.querySelector("main[data-marginalia]");
  if (!main) return;
  const api = main.dataset.marginalia;
  const page = main.dataset.page;
  const noteId = main.dataset.note;
  const full = main.dataset.view === "full";
  const wide = window.matchMedia("(min-width: 75rem)");

  let generation = null;
  let choices = [];
  let agent = "";
  let threads = [];
  /** The words selected last: { quote, prefix, suffix }. */
  let selected = null;
  /**
   * The one box being written in (a comment sheet or a reply), and writes on their way. While either is, the page isn't
   * redrawn under the reader; what changed meanwhile (`behind`) is drawn after.
   */
  let editor = null;
  let sending = 0;
  const busy = () => editor !== null || sending > 0;
  let behind = false;

  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const kid of kids) if (kid) node.append(kid);
    return node;
  };
  const article = () => main.querySelector("article");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const requestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
  const when = (iso) => (iso || "").slice(0, 16).replace("T", " ");

  const margin = el("div", { id: "mg-margin", class: "mg-ui" });
  main.append(margin);
  const bar = el("div", { id: "mg-bar", class: "mg-ui", hidden: "" });
  const toast = el("div", { id: "mg-toast", class: "mg-ui", role: "status", hidden: "" });
  document.body.append(bar, toast);
  let toastTimer = 0;
  function say(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  // ---- Selection: the words, and the drawn words either side (the server finds them in the note's source).

  /** The page's text around a range, leaving the cards out: what's before it, in it and after it. */
  function around(range) {
    const walker = document.createTreeWalker(article(), NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement && node.parentElement.closest(".mg-card, .mg-whole, aside.margin-note") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let before = "", inside = "", after = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue || "";
      const starts = node === range.startContainer, ends = node === range.endContainer;
      if (starts || ends) {
        const from = starts ? range.startOffset : 0, to = ends ? range.endOffset : text.length;
        if (starts) before += text.slice(0, from);
        inside += text.slice(from, to);
        if (ends) after += text.slice(to);
      } else if (range.intersectsNode(node)) inside += text;
      else if (range.comparePoint(node, 0) < 0) before += text;
      else after += text;
    }
    return { before, inside, after };
  }

  function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const host = article();
    if (!host || !host.contains(range.commonAncestorContainer)) return null;
    const { before, inside, after } = around(range);
    const quote = (inside.trim() ? inside : selection.toString()).trim();
    if (!quote) return null;
    return { quote, prefix: before.slice(-64), suffix: after.slice(0, 64) };
  }

  let selectTimer = 0;
  document.addEventListener("selectionchange", () => {
    clearTimeout(selectTimer);
    selectTimer = setTimeout(() => {
      if (busy()) return;
      const now = readSelection();
      if (now) { selected = now; showBar(); }
      else {
        if (!bar.hidden) setTimeout(() => { if (!readSelection() && !busy()) hideBar(); }, 400);
        if (behind) catchUp();
      }
    }, 150);
  });

  function showBar() {
    bar.replaceChildren(...choices.map((choice) => el("button", {
      type: "button", text: choice.label,
      // Pressing a button mustn't drop the selection first.
      onpointerdown: (event) => event.preventDefault(),
      onclick: () => choose(choice.action),
    })));
    bar.hidden = !choices.length;
  }
  function hideBar() { bar.hidden = true; }

  /** Done with these words: the selection goes, unless the reader has already selected others. */
  function letGo(words) {
    const now = readSelection();
    if (now && now.quote !== words.quote) return;
    window.getSelection()?.removeAllRanges();
    hideBar();
  }

  // ---- Writing.

  async function send(body) {
    const response = await fetch(`${api}/write`, {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ page, ...(full ? { view: "full" } : {}), ...body }),
    });
    let answer;
    try { answer = await response.json(); } catch { answer = { ok: false, error: `the publisher answered ${response.status}` }; }
    if (!response.ok || !answer.ok) throw new Error(answer.error || `the publisher answered ${response.status}`);
    return answer;
  }

  function choose(action) {
    // The selection as it is now (the last one seen, when pressing the button let it go).
    const words = readSelection() || selected;
    if (!words) return;
    if (action === "copy") return copy(words);
    if (action === "comment" || action === "ask") return compose(action, words);
    act(action, words);
  }

  async function act(action, words) {
    sending += 1;
    try {
      const answer = await send({ action, ...words, requestId: requestId() });
      letGo(words);
      say(answer.said || "done");
    } catch (error) {
      say(error.message);
    } finally {
      sending -= 1;
      doneWriting();
    }
  }

  /** One box at a time: a second one waits until the first is sent or cancelled, so no draft is dropped. */
  function opening() {
    if (!editor) return true;
    say("finish or cancel what you're writing first");
    editor.focus();
    return false;
  }

  /** Sends what a box holds; the box can't change or be cancelled while it's on its way, and keeps the text when it's refused. */
  async function submit(input, buttons, why, body, saved) {
    input.readOnly = true;
    for (const button of buttons) button.disabled = true;
    sending += 1;
    try {
      const answer = await send(body);
      saved(answer);
    } catch (error) {
      why.textContent = `Not saved: ${error.message}. Your text is still here.`;
      why.hidden = false;
      input.readOnly = false;
      for (const button of buttons) button.disabled = false;
    } finally {
      sending -= 1;
      doneWriting();
    }
  }

  /** Comment or Ask: a sheet to write in. The text stays until the outline has it. */
  function compose(action, words) {
    if (!opening()) return;
    hideBar();
    const id = requestId();
    const input = el("textarea", { class: "mg-in", placeholder: action === "ask" ? `Ask @${agent || "margin"} about this passage (or leave it blank: what does this mean?)` : words ? "Comment on this passage" : "Comment on this note" });
    editor = input;
    const why = el("p", { class: "why", hidden: "" });
    const close = () => { sheet.remove(); editor = null; doneWriting(); };
    const cancel = el("button", { type: "button", class: "quiet", text: "Cancel", onclick: () => close() });
    const sendButton = el("button", { type: "button", text: action === "ask" ? "Ask" : "Send", onclick: () =>
      submit(input, [sendButton, cancel], why, { action, ...(words || { quote: "" }), body: input.value, requestId: id }, (answer) => {
        if (words) letGo(words);
        say(answer.said || "saved");
        close();
      }) });
    const sheet = el("div", { id: "mg-sheet", class: "mg-ui" },
      words ? el("p", { class: "q", text: `“${words.quote}”` }) : null,
      input, why,
      el("div", { class: "mg-row" }, cancel, sendButton));
    document.body.append(sheet);
    input.focus();
  }

  /** Copy with citation: the words as a Blockdown quote, then the note they're from (a reference and this page's link). */
  async function copy(words) {
    const title = document.title;
    const text = `> ${words.quote.replace(/\s*\n\s*/g, " ")}\n— ((${noteId}|${title.replace(/[|)]/g, " ")})) ${location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = el("textarea", { class: "mg-in" });
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    say("copied, with where it's from");
  }

  // ---- Threads as cards.

  function card(thread) {
    const bare = thread.kind === "highlight" && !thread.body && !thread.replies.length;
    const node = el("div", { class: `mg-card mg-ui${bare ? " bare" : ""}`, "data-thread": thread.id });
    node.append(el("div", { class: "who", text: [thread.kind, thread.by, when(thread.at)].filter(Boolean).join(" · ") }));
    if (thread.quote && !markOf(thread.id)) node.append(el("div", { class: "q", text: `“${thread.quote}”` }));
    if (thread.body) node.append(el("div", { class: "b", text: thread.body }));
    for (const reply of thread.replies) {
      node.append(el("div", { class: "reply" }, el("div", { class: "who", text: `${reply.by} · ${when(reply.at)}` }), el("div", { class: "b", text: reply.body })));
    }
    // Waiting while the last ask (the comment, or a reply of his starting @…) has no answer after it. A reply without
    // an @ is a note to himself: nothing waits on it.
    const turns = [{ by: thread.by, body: thread.body }, ...thread.replies];
    const ask = turns.map((turn, at) => (turn.by === "you" && /^@\S+/.test(turn.body) ? at : -1)).reduce((a, b) => Math.max(a, b), -1);
    const asked = ask >= 0 && !turns.slice(ask + 1).some((turn) => turn.by !== "you");
    if (asked) node.append(el("div", { class: "who", text: "waiting for the answer…" }));
    const row = el("div", { class: "mg-row" });
    row.append(
      el("button", { type: "button", text: "Reply", onclick: () => replyIn(node, thread, row) }),
      el("button", { type: "button", class: "quiet", text: bare ? "Remove" : "Resolve", onclick: () => act("resolve", { thread: thread.id }) }),
    );
    node.append(row);
    return node;
  }

  /** The thread read by the person: once per thread and page load, quietly (a failure only means it stays unread). */
  const marked = new Set();
  function markRead(id) {
    if (!id || marked.has(id)) return;
    marked.add(id);
    fetch(`${api}/write`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page, ...(full ? { view: "full" } : {}), action: "read", thread: id }) })
      .then((response) => { if (!response.ok) marked.delete(id); }, () => marked.delete(id));
  }

  /** `#thread=<id>` (a link from Recent replies): its card opened and brought into view, and the thread marked read. */
  let arrived = false;
  function arrive() {
    const wanted = /^#thread=([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
    if (!wanted || arrived) return;
    const node = document.querySelector(`.mg-card[data-thread="${CSS.escape(wanted)}"]`);
    if (!node) return;
    arrived = true;
    for (const on of document.querySelectorAll(".on")) on.classList.remove("on");
    node.classList.add("open", "on");
    markOf(wanted)?.classList.add("on");
    place();
    node.scrollIntoView({ block: "center" });
    markRead(wanted);
  }
  window.addEventListener("hashchange", () => { arrived = false; arrive(); });

  function replyIn(node, thread, row) {
    if (!opening()) return;
    markRead(thread.id);
    const id = requestId();
    const input = el("textarea", { class: "mg-in", placeholder: "Reply" });
    editor = input;
    const why = el("p", { class: "why", hidden: "" });
    const box = el("div", { class: "mg-reply" }, input, why);
    const done = () => { box.remove(); row.hidden = false; editor = null; doneWriting(); };
    const cancel = el("button", { type: "button", class: "quiet", text: "Cancel", onclick: () => done() });
    const sendButton = el("button", { type: "button", text: "Send", onclick: () =>
      submit(input, [sendButton, cancel], why, { action: "reply", thread: thread.id, body: input.value, requestId: id }, (answer) => {
        say(answer.said || "replied");
        done();
      }) });
    box.append(el("div", { class: "mg-row" }, cancel, sendButton));
    row.hidden = true;
    node.append(box);
    input.focus();
  }

  const markOf = (id) => article()?.querySelector(`mark.ann[data-ann="${CSS.escape(id)}"]`);
  const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table";

  function draw() {
    if (busy()) return;
    const host = article();
    if (!host) return;
    // The page's own asides were for readers without the script: the cards replace them.
    for (const old of document.querySelectorAll(".mg-card, .mg-whole, aside.margin-note")) old.remove();
    margin.replaceChildren();
    const whole = [];
    for (const thread of threads) {
      const node = card(thread);
      const mark = markOf(thread.id);
      if (!mark) { whole.push(node); continue; }
      if (wide.matches) margin.append(node);
      else {
        // Under its passage: after the paragraph (or list item) the words are in, after any cards already there.
        let at = mark.closest(BLOCKS) || mark;
        while (at.nextElementSibling && at.nextElementSibling.classList.contains("mg-card")) at = at.nextElementSibling;
        at.after(node);
      }
    }
    if (whole.length) {
      if (wide.matches) margin.prepend(...whole);
      else host.append(el("div", { class: "mg-whole" }, el("h2", { text: "On this note" }), ...whole));
    }
    host.append(el("div", { class: "mg-whole mg-ui" }, el("div", { class: "mg-row" }, el("button", { type: "button", class: "quiet", text: "Comment on this note", onclick: () => compose("comment", null) }))));
    place();
    arrive();
  }

  /** Wide: each card level with its words, pushed down past the one above. */
  function place() {
    if (!wide.matches) return;
    const top = margin.getBoundingClientRect().top;
    let floor = 0;
    for (const node of margin.children) {
      const mark = markOf(node.dataset.thread);
      const want = mark ? mark.getBoundingClientRect().top - top : 0;
      const y = Math.max(want, floor);
      node.style.top = `${y}px`;
      if (getComputedStyle(node).display !== "none") floor = y + node.offsetHeight + 8;
    }
    margin.style.minHeight = `${floor}px`;
  }

  // Tapping a highlight opens its card (a bare highlight's only way in) and marks the pair.
  document.addEventListener("click", (event) => {
    const mark = event.target instanceof Element ? event.target.closest("mark.ann[data-ann]") : null;
    if (!mark || !window.getSelection()?.isCollapsed) return;
    const node = document.querySelector(`.mg-card[data-thread="${CSS.escape(mark.dataset.ann)}"]`);
    for (const on of document.querySelectorAll(".on")) on.classList.remove("on");
    if (!node) return;
    node.classList.toggle("open");
    node.classList.add("on");
    mark.classList.add("on");
    place();
    node.scrollIntoView({ block: "nearest" });
    markRead(mark.dataset.ann);
  });
  wide.addEventListener("change", draw);
  let resizeTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(place, 150); });

  // ---- Keeping up: the threads route waits for the next change.

  /** The note fetched again (new marks, an edit). Anything short of drawing it leaves the page `behind`, tried again next read. */
  async function refresh() {
    behind = true;
    const response = await fetch(location.href, { headers: { accept: "text/html" }, cache: "no-store" });
    if (!response.ok) return;
    const fresh = new DOMParser().parseFromString(await response.text(), "text/html");
    // The reader selected words (or began writing) while it was on its way: it waits for them.
    if (busy() || readSelection()) return;
    for (const part of ["article", "section.inside", "footer"]) {
      const now = main.querySelector(part), next = fresh.querySelector(`main ${part}`);
      if (now && next) now.replaceWith(document.adoptNode(next));
    }
    behind = false;
  }

  let waking = null;
  function wake() { if (waking) waking(); }

  /** Writing's over: draw what changed meanwhile, and read again at once. */
  function doneWriting() {
    if (behind && !busy() && !readSelection()) catchUp();
    wake();
  }

  /** What changed while the reader had words selected or was writing, drawn now. */
  function catchUp() {
    refresh().catch(() => {}).finally(draw);
  }

  async function load(wait) {
    const query = new URLSearchParams({ page, ...(full ? { view: "full" } : {}) });
    if (wait && generation !== null) { query.set("since", String(generation)); query.set("wait", "20000"); }
    const response = await fetch(`${api}/threads?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`threads: ${response.status}`);
    const data = await response.json();
    const first = generation === null;
    const changed = !first && data.generation !== generation;
    generation = data.generation;
    choices = data.choices || [];
    agent = data.agent || "";
    threads = data.threads || [];
    // A selection made before the toolbar knew its choices gets them now.
    if (first && readSelection()) { selected = readSelection(); showBar(); }
    if (changed) behind = true;
    if (!first && !behind) return false;
    // Never under the reader's hands: while words are selected or something is being written, the page waits.
    if (busy() || readSelection()) return changed;
    if (behind) await refresh().catch(() => {});
    draw();
    return changed;
  }

  (async () => {
    for (let failures = 0; ; ) {
      if (document.hidden) await new Promise((resolve) => document.addEventListener("visibilitychange", resolve, { once: true }));
      try {
        // A busy outline changes often: at most one read a second.
        if (await load(true)) await sleep(1000);
        failures = 0;
      } catch {
        failures += 1;
        await Promise.race([sleep(Math.min(30000, 2000 * failures)), new Promise((resolve) => { waking = resolve; })]);
      }
      // Right after a write, read again at once; otherwise the long poll above was the wait.
      if (busy()) await new Promise((resolve) => { waking = resolve; });
      waking = null;
    }
  })();
})();
