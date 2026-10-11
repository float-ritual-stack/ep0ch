// The tailnet web client's reader (PIE-774, PIE-782): marginalia on a note's page. Served by the publisher at
// `<base>/_marginalia/reader.js`, the only script its pages run (publish.ts READER_CSP), on tailnet pages only.
//
// - Select words in the note: a toolbar along the bottom (a thumb reaches it, and it never covers the phone's own
//   selection menu) offers what the page's threads route says it can: Highlight, Comment, Ask, Copy, Explain, …
// - Comment and Ask open a sheet to write in; what's written stays in it until the outline has it (a refusal keeps
//   the text, says why, and Send tries again with the same request id, so a retry never writes twice).
// - Threads are cards: beside the text when the window is wide, under their passage when it's narrow, with Reply and
//   Resolve. A highlight alone has no card until its words are tapped.
// - The page waits on the threads route until what it draws changes (a long poll on the page's own `version`, so a
//   busy outline elsewhere doesn't wake it), so an answer lands on the page soon after it lands in the outline; the
//   note itself is fetched again then, so new marks show. Idle, that's about three requests a minute.
// - Opening a thread marks it read (the `/replies` page's unread marks clear): arriving at `#thread=<id>` from Recent
//   replies (its card opens and comes into view), tapping its words, or replying in it.
// - What's in front of the reader is said (presence): the page, and the words selected on it (debounced, at most 2,000
//   characters), posted to `view`, so an agent in chat can say "you have X selected" (`reader.view`). The same words are
//   in the page itself, in `#ep0ch-selection` (aria-live), for an agent driving a browser. With them go the blocks on
//   screen and how far down the page is, and a fold opened or closed: the service keeps what the reader did (the
//   journal) with it.
// - Page helpers for an agent that sees the page (`window.ep0ch`, and the same as WebMCP tools on
//   `navigator.modelContext` when the page has one): help(), view(), reveal(ref), journal(since), from one list of
//   definitions. They only read and point: nothing they do writes. The page says when an agent calls one.
// - The same script runs on a share link's pages (share-sessions.ts), below the link; one without comments offers Copy.
//
// Dark throughout, no animation, nothing that flashes (Evan is photosensitive). Plain DOM, no build, no eval: text is
// set as text, never as HTML.
(() => {
  "use strict";
  // The WebMCP polyfill the publisher serves after this script answers an extension in this tab from this page's
  // origin only (its default is any origin).
  window.__webModelContextOptions = { transport: { tabServer: { allowedOrigins: [location.origin] } } };
  const main = document.querySelector("main[data-marginalia]");
  if (!main) return;
  const api = main.dataset.marginalia;
  const page = main.dataset.page;
  const noteId = main.dataset.note;
  const full = main.dataset.view === "full";
  const wide = window.matchMedia("(min-width: 75rem)");

  /** The version of what the page draws, as the threads route last said (null until it has). */
  let version = null;
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
  // The selection as words in the page, for a reader of the page that isn't a person (an agent driving a browser).
  const shown = el("div", { id: "ep0ch-selection", class: "mg-sr", "aria-live": "polite", "data-page": noteId || "" });
  document.body.append(shown);
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

  // ---- Presence: what's in front of the reader, said when it changes (and when the page comes back into view).

  const SELECTION_MAX = 2000;
  const VISIBLE_MAX = 200;

  /** The blocks the page draws (anchors in the note, rows in its folder), each with the element it is on the page. */
  function blocks() {
    return [...main.querySelectorAll("[data-block]")].map((node) => ({ id: node.dataset.block, node: drawnAt(node) }));
  }
  /** Where a block is drawn: its list row, else the heading or paragraph its anchor ends. */
  function drawnAt(node) {
    if (node.tagName !== "SPAN") return node;
    return node.closest("li") || node.parentElement.closest("h1,h2,h3,h4,h5,h6,p,blockquote,pre,table,div") || node.parentElement;
  }
  /** The block a node of the page is in: the last anchor before it. */
  function blockOf(node) {
    let found = null;
    for (const { id, node: at } of blocks()) {
      if (at === node || at.contains(node) || at.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = id;
      else break;
    }
    return found;
  }
  function onScreen() {
    const height = window.innerHeight || document.documentElement.clientHeight;
    const ids = [];
    for (const { id, node } of blocks()) {
      const box = node.getBoundingClientRect();
      if (box.bottom > 0 && box.top < height && !ids.includes(id)) ids.push(id);
      if (ids.length >= VISIBLE_MAX) break;
    }
    return ids;
  }

  /** What's in front of the reader now, as the page tells the service (one source for presence and ep0ch.view()). */
  function snapshot() {
    const now = readSelection();
    const words = now ? { quote: now.quote.slice(0, SELECTION_MAX), prefix: now.prefix, suffix: now.suffix } : null;
    shown.textContent = words ? words.quote : "";
    const max = Math.max(0, Math.round(document.documentElement.scrollHeight - window.innerHeight));
    return { page, ...(full ? { view: "full" } : {}), title: document.title, url: location.href, ...(words || {}), visible: onScreen(), scroll: { y: Math.round(window.scrollY), max } };
  }

  let said = "";
  let sayTimer = 0;
  /** The service's answer to the last report: the view it kept and the reader's journal. */
  let seen = null;
  /** Says what's in front of the reader now, if that changed (or `extra`, a fold, goes with it); the service's answer. */
  async function report(extra) {
    clearTimeout(sayTimer);
    const body = JSON.stringify({ ...snapshot(), ...(extra || {}) });
    if (body === said && seen) return seen;
    said = body;
    try {
      const response = await fetch(`${api}/view`, { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", keepalive: true, body });
      const answer = await response.json();
      if (!response.ok || !answer.ok) throw new Error(answer.error || `the publisher answered ${response.status}`);
      seen = answer;
    } catch (error) {
      said = "";
      throw error;
    }
    return seen;
  }
  function present() {
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { if (!document.hidden) report().catch(() => {}); }, 600);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { said = ""; present(); } });
  window.addEventListener("scroll", present, { passive: true });
  // A fold (a collapsible callout, a summary) opened or closed goes in the journal; `toggle` doesn't bubble.
  main.addEventListener("toggle", (event) => {
    const id = event.target instanceof Element ? blockOf(event.target) : null;
    if (id) report({ fold: { blockId: id, open: !!event.target.open } }).catch(() => {});
  }, true);
  present();

  let selectTimer = 0;
  document.addEventListener("selectionchange", () => {
    present();
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

  /** The thread read by the person, quietly (a failure only means it stays unread); one request at a time per thread. */
  const reading = new Set();
  function markRead(id) {
    if (!id || reading.has(id)) return;
    reading.add(id);
    fetch(`${api}/write`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page, ...(full ? { view: "full" } : {}), action: "read", thread: id }) })
      .catch(() => {}).finally(() => reading.delete(id));
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
    if (choices.some((choice) => choice.action === "comment")) {
      host.append(el("div", { class: "mg-whole mg-ui" }, el("div", { class: "mg-row" }, el("button", { type: "button", class: "quiet", text: "Comment on this note", onclick: () => compose("comment", null) }))));
    }
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
    if (wait && version !== null) { query.set("since", version); query.set("wait", "20000"); }
    const response = await fetch(`${api}/threads?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`threads: ${response.status}`);
    const data = await response.json();
    const first = version === null;
    const changed = !first && data.version !== version;
    version = data.version;
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

  // ---- Page helpers: for an agent that sees this page (a browser pane beside the chat), so it reads and points with
  // one call instead of writing its own script. One list of definitions makes `window.ep0ch`, its `help()` catalog and
  // the WebMCP tools, so the three can't drift. They read and point; none writes. Nothing a note holds runs here (the
  // page's policy runs this script and the WebMCP polyfill only), so only an agent's own script reaches them.

  const pageBase = api.slice(0, api.length - "/_marginalia".length);
  const agentSign = el("div", { id: "ep0ch-agent", class: "mg-ui", role: "status", hidden: "" });
  document.body.append(agentSign);
  let signTimer = 0;
  /** Says on the page what an agent just did through a helper, for a few seconds. */
  function agentDid(text) {
    agentSign.textContent = text;
    agentSign.hidden = false;
    clearTimeout(signTimer);
    signTimer = setTimeout(() => { agentSign.hidden = true; }, 6000);
  }

  let pointed = null;
  let pointTimer = 0;
  /** Scrolls to a block and marks it for a few seconds: a still outline, no animation. Pointing never writes. */
  function reveal(ref) {
    const wanted = String(ref || "").trim().replace(/^\(\(/, "").replace(/\)\)$/, "").split("|")[0].trim();
    if (wanted.length < 8) return { ok: false, why: "reveal takes a block: its id, ((id)) or ((id|label)) (at least the first 8 characters of the id)" };
    const hits = blocks().filter((block) => block.id === wanted || block.id.startsWith(wanted));
    const ids = [...new Set(hits.map((block) => block.id))];
    if (ids.length > 1) return { ok: false, why: `${wanted} starts ${ids.length} blocks on this page: give more of the id`, blocks: ids };
    if (!hits.length) {
      return { ok: false, why: `((${wanted})) isn't on this page; its own page is ${location.origin}${pageBase}/p/${encodeURIComponent(wanted)} (reveal doesn't leave the page)` };
    }
    const node = hits[0].node;
    if (pointed) pointed.classList.remove("ep0ch-pointed");
    clearTimeout(pointTimer);
    node.classList.add("ep0ch-pointed");
    pointed = node;
    pointTimer = setTimeout(() => { node.classList.remove("ep0ch-pointed"); if (pointed === node) pointed = null; }, 5000);
    node.scrollIntoView({ block: "center", behavior: "auto" });
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    agentDid(`an agent is pointing at “${text.length > 60 ? `${text.slice(0, 60)}…` : text}”`);
    return { ok: true, blockId: ids[0], text: text.slice(0, 300) };
  }

  /** What's in front of the reader, as the service keeps it; this page's own reading when the service can't be reached. */
  async function view() {
    try {
      return (await report()).view;
    } catch (error) {
      const now = snapshot();
      return {
        offline: `the publisher couldn't be reached (${error.message}): this is the page's own reading, without the selection's place in the source`,
        blockId: noteId, title: now.title, url: now.url,
        ...(now.quote ? { selection: { text: now.quote, before: now.prefix, after: now.suffix } } : {}),
        visible: now.visible, scroll: now.scroll,
      };
    }
  }

  /** What the reader did after event `since` (pages opened, words selected, folds), oldest first, and the number to pass next time. */
  async function journal(since) {
    const after = Number(since) || 0;
    try { await report(); } catch { /* the journal as the page last had it */ }
    const events = ((seen && seen.journal) || []).filter((event) => event.n > after);
    return { events, next: events.length ? events[events.length - 1].n : after };
  }

  const HELPERS = [
    {
      name: "help", args: [],
      description: "The page helpers: each one's call, what it does and its arguments (JSON Schema). The same list is this page's WebMCP tools.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      did: () => "an agent read this page's helpers",
      run: () => catalog(),
    },
    {
      name: "view", args: [],
      description: "What the reader has in front of them now: the note (blockId, title, url), the words selected (text, before, after, the block they're in and their offsets in its source at its revision), the blocks on screen (visible, in page order) and the scroll position. The same as the outline's reader.view.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      did: () => "an agent is reading what's on screen",
      run: () => view(),
    },
    {
      name: "reveal", args: ["ref"],
      description: "Scroll the page to a block and mark it for a few seconds, to point at it. Takes the block's id, ((id)) or ((id|label)); a block that isn't on this page is refused with its own page's address. Never writes.",
      inputSchema: { type: "object", properties: { ref: { type: "string", description: "The block: its id (at least 8 characters), ((id)) or ((id|label))" } }, required: ["ref"], additionalProperties: false },
      did: null,
      run: ({ ref }) => reveal(ref),
    },
    {
      name: "journal", args: ["since"],
      description: "What the reader did lately, oldest first: pages opened, words selected, folds opened or closed, across pages. Pass the `next` of the last answer as since to get only what's new.",
      inputSchema: { type: "object", properties: { since: { type: "number", description: "Only events after this one (`next` from the last answer); 0 or left out for all that's kept" } }, additionalProperties: false },
      did: () => "an agent is reading what you did lately",
      run: ({ since }) => journal(since),
    },
  ];

  function catalog() {
    return HELPERS.map((helper) => ({
      call: `ep0ch.${helper.name}(${helper.args.join(", ")})`, tool: `ep0ch_${helper.name}`,
      description: helper.description, inputSchema: helper.inputSchema,
    }));
  }

  /** A helper called by an agent: said on the page, then run. */
  async function call(helper, input) {
    if (helper.did) agentDid(helper.did());
    return helper.run(input || {});
  }

  const ep0ch = {};
  for (const helper of HELPERS) {
    ep0ch[helper.name] = (...values) => call(helper, Object.fromEntries(helper.args.map((name, at) => [name, values[at]])));
  }
  Object.defineProperty(window, "ep0ch", { value: Object.freeze(ep0ch), enumerable: true });

  // WebMCP: the same helpers as tools, once the page has navigator.modelContext (the browser's own, or the polyfill the
  // publisher serves after this script). The page works the same without it.
  function registerTools() {
    const context = navigator.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    for (const helper of HELPERS) {
      try {
        context.registerTool({
          name: `ep0ch_${helper.name}`, description: helper.description, inputSchema: helper.inputSchema,
          annotations: { readOnlyHint: true },
          execute: async (input) => ({ content: [{ type: "text", text: JSON.stringify(await call(helper, input)) }] }),
        });
      } catch { /* already registered, or a context that refuses it: window.ep0ch still works */ }
    }
  }
  if (document.readyState === "complete") registerTools();
  else window.addEventListener("load", registerTools, { once: true });
})();
