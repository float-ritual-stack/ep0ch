// The tailnet web client's reader (PIE-774, PIE-782): marginalia on a note's page. Served by the publisher at
// `<base>/_marginalia/reader.js`, the only script its pages run (publish.ts READER_CSP), on tailnet pages only.
//
// - Select words in the note: a toolbar along the bottom (a thumb reaches it, and it never covers the phone's own
//   selection menu) offers what the page's threads route says it can: Highlight, Comment, Ask, Copy, Explain, …
// - In a comment or reply box, `[[`, `((` and `#` complete as in the door (PIE-789): the publisher's `complete` route
//   answers from the service's lookups; up/down choose, Enter or Tab inserts the same Blockdown the door writes, Esc
//   dismisses. Nothing is required: what's typed is saved as typed.
// - Comment and Ask open a sheet to write in; what's written stays in it until the outline has it (a refusal keeps
//   the text, says why, and Send tries again with the same request id, so a retry never writes twice).
// - Threads are cards: beside the text when the window is wide, under their passage when it's narrow, with Reply,
//   Resolve and Quote. A highlight alone has no card until its words are tapped.
// - A card's own words select like the note's: Highlight, Comment or Ask on them lands on that mark (threads of
//   threads), drawn on its words in the card; tapping one opens its card inside.
// - Quote: one card's Quote, or Pick on several and then Quote N, opens a sheet: the Inbox (the default), under this
//   note, or under a note found by its words, and words of your own. The new block transcludes each mark and links
//   back; the toast opens it, or undoes it. A card says where it's been quoted.
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
// - Another machine's outline that takes no writes now (read from its copy while the machine is away, or at `read` access)
//   shows its threads with no Reply, Resolve or Quote, and says why (`readOnly`); its toolbar offers Copy.
//
// Dark throughout, no animation, nothing that flashes (Evan is photosensitive). Plain DOM, no build, no eval: text is
// set as text, never as HTML.
(() => {
  "use strict";
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const datedClock = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const fullClock = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" });
  function formatTimes(root = document) {
    const now = new Date();
    for (const time of root.querySelectorAll("time[datetime]")) {
      const date = new Date(time.dateTime);
      const minutes = Math.floor((now - date) / 60000);
      const relative = minutes < 0 || minutes >= 1440 ? "" : minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
      time.textContent = (date.toDateString() === now.toDateString() ? clock : datedClock).format(date) + (relative ? ` · ${relative}` : "");
      time.title = fullClock.format(date);
    }
  }
  formatTimes();
  // The WebMCP polyfill the publisher serves after this script answers an extension in this tab from this page's
  // origin only (its default is any origin), and never a page that frames this one (none may: frame-ancestors 'none').
  window.__webModelContextOptions = { transport: { tabServer: { allowedOrigins: [location.origin] }, iframeServer: false } };
  const main = document.querySelector("main[data-marginalia]");
  if (!main) return;
  const api = main.dataset.marginalia;
  const page = main.dataset.page;
  const noteId = main.dataset.note;
  const full = main.dataset.view === "full";
  const wide = window.matchMedia("(min-width: 65rem)");

  /** The version of what the page draws, as the threads route last said (null until it has). */
  let version = null;
  let choices = [];
  let agent = "";
  let threads = [];
  /** Why the page takes no writes now (another machine's outline, read from its copy or at `read` access); empty when it does. */
  let readOnly = "";
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
  const when = (iso) => el("time", { datetime: iso, text: `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC` });

  const margin = el("div", { id: "mg-margin", class: "mg-ui" });
  main.append(margin);
  // The selection as words in the page, for a reader of the page that isn't a person (an agent driving a browser).
  const shown = el("div", { id: "ep0ch-selection", class: "mg-sr", "aria-live": "polite", "data-page": noteId || "" });
  document.body.append(shown);
  const bar = el("div", { id: "mg-bar", class: "mg-ui", hidden: "" });
  const toast = el("div", { id: "mg-toast", class: "mg-ui", role: "status", hidden: "" });
  document.body.append(bar, toast);
  let toastTimer = 0;
  /** A word in the toast, with any links or buttons after it (kept up longer then, so there's time to reach them). */
  function say(text, ...after) {
    toast.replaceChildren(text, ...after);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, after.length ? 12000 : 5000);
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

  /** The card words (a mark's own, `.b[data-mark]`) a point of a selection is in, or null. */
  const ownWords = (node) => (node instanceof Element ? node : node && node.parentElement)?.closest(".b[data-mark]") || null;

  function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    // Words of one card: a passage of that mark's own text (`in`), the card's words either side.
    const words = ownWords(range.startContainer);
    if (words && words === ownWords(range.endContainer)) {
      const before = document.createRange(), after = document.createRange();
      before.setStart(words, 0); before.setEnd(range.startContainer, range.startOffset);
      after.setStart(range.endContainer, range.endOffset); after.setEnd(words, words.childNodes.length);
      const quote = range.toString().trim();
      if (!quote) return null;
      return { quote, prefix: before.toString().slice(-64), suffix: after.toString().slice(0, 64), in: words.dataset.mark };
    }
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
    const enclosed = (node instanceof Element ? node : node.parentElement)?.closest("[data-block]");
    if (enclosed) return enclosed.dataset.block;
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

  /** This tab, across its pages: on a share, the journal the page gets back is this tab's alone. */
  const visitor = (() => {
    const made = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, "");
    try {
      const kept = sessionStorage.getItem("ep0ch-visitor");
      if (kept) return kept;
      sessionStorage.setItem("ep0ch-visitor", made);
    } catch { /* storage refused: this page alone */ }
    return made;
  })();

  let sayTimer = 0;
  /** The last report the service answered, and its answer: the view it kept and the journal. */
  let said = "";
  let seen = null;
  /** Reports one at a time, in order, so an older answer never stands for a newer report. */
  let reporting = Promise.resolve();
  /** Says what's in front of the reader now, if that changed (or `extra`, a fold, goes with it); the service's answer. */
  function report(extra) {
    clearTimeout(sayTimer);
    const body = JSON.stringify({ ...snapshot(), ...(extra || {}), visitor });
    const run = reporting.then(async () => {
      if (body === said && seen) return seen;
      const response = await fetch(`${api}/view`, { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", keepalive: true, body });
      const answer = await response.json();
      if (!response.ok || !answer.ok) throw new Error(answer.error || `the publisher answered ${response.status}`);
      said = body;
      seen = answer;
      drawTrail(answer.trail);
      return seen;
    });
    reporting = run.catch(() => {});
    return run;
  }
  /**
   * The trail (PIE-208): the notes this tab opened, newest first, as the service's journal keeps them. A `≡ trail` link
   * at the end of the breadcrumbs opens the list under them, each stop a link back to its page; the page shown is lit.
   */
  let trailList = null, trailDrawn = "";
  function drawTrail(stops) {
    const crumbs = main.querySelector("nav.crumbs");
    if (!crumbs || !Array.isArray(stops)) return;
    // Drawn again only when the stops changed: a report on every scroll never takes focus out of the open list.
    const drawn = JSON.stringify(stops.map((stop) => [stop.blockId, stop.title]));
    if (drawn === trailDrawn) return;
    trailDrawn = drawn;
    if (!trailList) {
      const toggle = document.createElement("a");
      toggle.href = "#mg-trail"; toggle.className = "mg-trail"; toggle.textContent = "≡ trail";
      toggle.setAttribute("aria-controls", "mg-trail"); toggle.setAttribute("aria-expanded", "false");
      trailList = document.createElement("section");
      trailList.id = "mg-trail"; trailList.className = "inside"; trailList.hidden = true;
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        trailList.hidden = !trailList.hidden;
        toggle.setAttribute("aria-expanded", String(!trailList.hidden));
      });
      crumbs.append(" · ", toggle);
      crumbs.after(trailList);
    }
    const toggle = crumbs.querySelector("a.mg-trail");
    toggle.hidden = stops.length < 2;
    if (toggle.previousSibling && toggle.previousSibling.nodeType === Node.TEXT_NODE) toggle.previousSibling.textContent = stops.length < 2 ? "" : " · ";
    const heading = document.createElement("h2");
    heading.textContent = "Where you've been";
    const list = document.createElement("ul");
    list.className = "kids";
    for (const stop of stops) {
      const item = document.createElement("li"), link = document.createElement("a");
      link.href = `${pageBase}/p/${encodeURIComponent(stop.blockId)}`;
      // Each stop reads as the site's other rows do (PIE-1418): its title in the link colour; the page shown is lit, not a link look.
      const title = document.createElement("span");
      title.className = "t";
      title.textContent = stop.blockId === noteId ? `● ${stop.title || "this page"} · here` : stop.title || stop.blockId;
      link.append(title);
      if (stop.blockId === noteId) link.setAttribute("aria-current", "page");
      item.append(link);
      list.append(item);
    }
    trailList.replaceChildren(heading, list);
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
    // The words are kept as they're chosen, so a button pressed at once acts on these words, never the last ones.
    if (!busy()) { const now = readSelection(); if (now) selected = now; }
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
      onmousedown: (event) => event.preventDefault(),
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
    // The words as they're selected now: a highlight is drawn on them the moment it lands, before the page is read again.
    const selection = window.getSelection();
    const range = action === "highlight" && selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    try {
      const answer = await send({ action, ...words, requestId: requestId() });
      if (range && article()?.contains(range.commonAncestorContainer)) markRange(range, { kind: "highlight", tone: "default", id: answer.thread || "", placed: "pending" });
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

  // ---- Completion in a box (PIE-789): `[[`, `((` and `#` offer what the door's completer offers, from the service's
  // lookups, and choosing one writes the same Blockdown. The publisher finds the token with the outliner's own
  // completion rules: the page sends the line being written and where the cursor is in it, nothing else.

  function completing(input) {
    const pop = el("div", { class: "mg-complete", role: "listbox", hidden: "" });
    input.after(pop);
    // `asked` is the box as the shown list was asked for it: its text and cursor. Any change makes the list stale: it
    // stays drawn (nothing flashes) but takes no keys and inserts nothing until the next answer.
    let items = [], at = -1, span = null, asked = null, timer = 0, question = 0;
    const hide = () => { question += 1; pop.hidden = true; items = []; at = -1; span = null; asked = null; };
    const current = () => asked && input.value === asked.value && input.selectionStart === asked.cursor && input.selectionEnd === asked.cursor;
    function draw(message) {
      pop.replaceChildren(...items.map((item, index) => el("button", {
        type: "button", role: "option", class: index === at ? "on" : "",
        // Choosing keeps the box's focus (and the phone's keyboard up).
        onpointerdown: (event) => event.preventDefault(), onclick: () => choose(index),
      }, el("span", { class: "l", text: item.label }), item.detail ? el("span", { class: "d", text: item.detail }) : null)),
      ...(items.length ? [] : [el("p", { class: "dim", text: message || "nothing to choose" })]));
      pop.hidden = false;
      pop.querySelector("button.on")?.scrollIntoView({ block: "nearest" });
    }
    async function look() {
      const value = input.value, cursor = input.selectionStart;
      if (cursor !== input.selectionEnd) return hide();
      // The cursor's line, and the lines before it (whether it's in a code fence), from a line's start.
      const lineEnd = value.indexOf("\n", cursor) < 0 ? value.length : value.indexOf("\n", cursor);
      const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
      if (!/\[\[|\(\(|#/.test(value.slice(lineStart, cursor))) return hide();
      let from = Math.max(0, cursor - 4000);
      if (from > 0) from = Math.min(value.indexOf("\n", from) + 1 || lineStart, lineStart);
      const mine = ++question;
      try {
        const response = await fetch(`${api}/complete?${new URLSearchParams({ text: value.slice(from, lineEnd), at: String(cursor - from), page })}`, { cache: "no-store" });
        const answer = await response.json();
        // An older question's answer, or the box changed meanwhile: dropped.
        if (mine !== question || input.value !== value || input.selectionStart !== cursor || input.selectionEnd !== cursor) return;
        if (!response.ok || !answer.kind) return hide();
        asked = { value, cursor };
        span = { from: from + answer.start, to: from + answer.end };
        items = answer.items || [];
        at = items.length ? 0 : -1;
        draw(answer.message);
      } catch { if (mine === question) hide(); }
    }
    function choose(index) {
      const item = items[index];
      if (!item || !span || !current()) return false;
      input.focus();
      input.setSelectionRange(span.from, span.to);
      // As typed: the box's own undo takes it back.
      if (!document.execCommand || !document.execCommand("insertText", false, item.insertion)) {
        input.setRangeText(item.insertion, span.from, span.to, "end");
      }
      hide();
      return true;
    }
    const again = () => { clearTimeout(timer); timer = setTimeout(look, 120); };
    input.addEventListener("input", again);
    // The cursor moved without typing (a click, an arrow): ask again where it is now.
    input.addEventListener("click", () => { if (!pop.hidden && !current()) again(); });
    input.addEventListener("keyup", (event) => { if (!pop.hidden && !current() && /^(Arrow(Left|Right)|Home|End)$/.test(event.key)) again(); });
    input.addEventListener("keydown", (event) => {
      if (pop.hidden) return;
      if (event.key === "Escape") { event.preventDefault(); hide(); return; }
      // A stale list (typed since, or the cursor moved) lets every key through.
      if (!items.length || !current()) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        at = (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        draw();
      } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        choose(at);
      }
    });
    input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) hide(); }, 200));
  }

  /** Comment or Ask: a sheet to write in. The text stays until the outline has it. */
  function compose(action, words) {
    if (!opening()) return;
    hideBar();
    const id = requestId();
    const input = el("textarea", { class: "mg-in", placeholder: action === "ask" ? `Ask @${agent || "margin"} about this passage (or leave it blank: what does this mean?)` : words && words.in ? "Comment on these words of the comment" : words ? "Comment on this passage" : "Comment on this note" });
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
    completing(input);
    input.focus();
  }

  /** Copy with citation: the words as a Blockdown quote, then the note they're from (a reference and this page's link). */
  async function copy(words) {
    const title = document.title;
    const text = `> ${words.quote.replace(/\s*\n\s*/g, " ")}\n— ((${words.in || noteId}|${title.replace(/[|)]/g, " ")})) ${location.origin}${location.pathname}`;
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

  /** A mark's own words in its card, the marks on them drawn on their words (each opens its card in the nest below). */
  function ownText(id, text, marks) {
    const node = el("div", { class: "b", "data-mark": id });
    let cursor = 0;
    for (const mark of marks) {
      const at = mark.quote ? text.indexOf(mark.quote, cursor) : -1;
      if (at < 0) continue;
      node.append(text.slice(cursor, at), el("mark", { class: `ann ann-${mark.tone}`, "data-sub": mark.id, "data-kind": mark.kind, text: mark.quote }));
      cursor = at + mark.quote.length;
    }
    node.append(text.slice(cursor));
    return node;
  }

  /** Where a mark's been quoted: each block linked (its page), or said when this page can't link it. */
  function quotedLine(quotedIn) {
    if (!quotedIn || !quotedIn.length) return null;
    const line = el("div", { class: "quoted" }, "quoted in ");
    quotedIn.forEach((quote, at) => {
      if (at) line.append(", ");
      line.append(quote.href ? el("a", { href: quote.href, text: quote.title || "a note" }) : quote.title || "a note");
    });
    return line;
  }

  /** Quote (this mark alone) and Pick (one of several to quote together). */
  function quoteButtons(id) {
    if (readOnly) return [];
    return [
      el("button", { type: "button", class: "quiet", text: "Quote", onclick: () => quote([id]) }),
      el("button", { type: "button", class: `quiet${picked.has(id) ? " on" : ""}`, "data-pick": id, text: picked.has(id) ? "Picked" : "Pick", onclick: () => pick(id) }),
    ];
  }

  /**
   * A thread's card. At rest it's short: who, the words it's on (when they aren't marked on the page), its first lines
   * and how many replies. Open (the active card, `.on`), it's all of it with its actions. Tapping a resting card opens it.
   */
  /** A thread that's been put away (PIE-791): seen, or a resolved one with something said on it. */
  const isEarlier = (thread) => thread.lifecycle === "seen" || thread.lifecycle === "resolved";

  /**
   * A mark's words as the page draws a note's (references by title, links, Markdown: the server's renderer, so authored
   * HTML is already text), or its plain words where it has marks of its own (they're drawn on those words) or no drawing.
   */
  function words(item, marks) {
    if (!item.html || (marks && marks.length)) return ownText(item.id, item.body, marks || []);
    const node = el("div", { class: "b rich", "data-mark": item.id });
    node.innerHTML = item.html;
    return node;
  }

  /**
   * A thread's card. At rest it's short: who, the words it's on (when they aren't marked on the page), its TL;DR or its
   * first lines, and how many replies. Open (the active card, `.on`), it's all of it, the discussion folded behind a
   * TL;DR, with its actions on one row: Reply, Seen (or Back), Keep (or Unkeep), TL;DR, and ⋯ for Quote and Pick.
   */
  function card(thread, top) {
    const bare = thread.kind === "highlight" && !thread.body && !thread.replies.length;
    const earlier = isEarlier(thread), kept = thread.lifecycle === "kept";
    const node = el("div", { class: `mg-card mg-ui${top ? " top" : ""}${bare ? " bare" : ""}${earlier ? " earlier" : ""}${kept ? " kept" : ""}${picked.has(thread.id) ? " picked" : ""}`, "data-thread": thread.id });
    node.append(el("div", { class: "who" }, `${thread.kind} · ${thread.by} · `, when(thread.at), ...[editedSaid(thread), kept ? "kept" : "", earlier ? "seen" : ""].filter(Boolean).map(s => ` · ${s}`)));
    if (thread.quote && !markOf(thread.id)) {
      // Drawn as the note's words are (a reference by its title, a link), from the server's renderer; else as typed.
      const said = el("div", { class: "q" }, "“");
      if (thread.quoteHtml) { const words = el("span", { class: "rich" }); words.innerHTML = thread.quoteHtml; said.append(words); }
      else said.append(thread.quote);
      said.append("”");
      node.append(said);
    }
    const marks = thread.marks || [];
    const face = thread.tldr ? thread.replies.find((reply) => reply.id === thread.tldr) : null;
    // A TL;DR is the thread's face; what it's about is folded behind it.
    const discussion = face ? el("details", { class: "disc" }, el("summary", { text: `the discussion · ${(thread.body ? 1 : 0) + thread.replies.length - 1} more` })) : node;
    if (face) node.append(el("div", { class: "tldr" }, el("span", { class: "k", text: "TL;DR" }), words(face, face.marks), nest(face.marks || [])), discussion);
    if (thread.body) discussion.append(words(thread, marks));
    if (top && thread.replies.length && !face) node.append(el("div", { class: "sum", text: `${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"} · ${thread.replies[thread.replies.length - 1].by}` }));
    const nested = nest(marks);
    if (nested) discussion.append(nested);
    for (const reply of thread.replies) {
      if (face && reply.id === face.id) continue;
      const replyMarks = reply.marks || [];
      // Each reply's own row: Edit (where this page may, PIE-763), Quote and Pick.
      const replyRow = el("div", { class: "mg-row" });
      replyRow.append(...(reply.edit && !readOnly ? [el("button", { type: "button", class: "quiet", text: "Edit", onclick: () => editIn(node, reply, replyRow) })] : []), ...quoteButtons(reply.id));
      discussion.append(el("div", { class: `reply${picked.has(reply.id) ? " picked" : ""}`, "data-reply": reply.id },
        el("div", { class: "who" }, `${reply.by} · `, when(reply.at), ...[editedSaid(reply), reply.tldr ? "TL;DR" : ""].filter(Boolean).map(s => ` · ${s}`)), words(reply, replyMarks), nest(replyMarks),
        quotedLine(reply.quotedIn), replyRow));
    }
    const quotes = quotedLine(thread.quotedIn);
    if (quotes) node.append(quotes);
    // Waiting while the last ask (the comment, or a reply of his starting @…) has no answer after it. A reply without
    // an @ is a note to himself: nothing waits on it.
    const turns = [{ by: thread.by, body: thread.body }, ...thread.replies];
    const ask = turns.map((turn, at) => (turn.by === "you" && /^@\S+/.test(turn.body) ? at : -1)).reduce((a, b) => Math.max(a, b), -1);
    const asked = ask >= 0 && !turns.slice(ask + 1).some((turn) => turn.by !== "you");
    if (asked) node.append(el("div", { class: "who", text: "waiting for the answer…" }));
    if (top) node.addEventListener("click", (event) => {
      if (node.classList.contains("on") || !window.getSelection()?.isCollapsed) return;
      if (event.target instanceof Element && event.target.closest("a, button, mark, summary")) return;
      activate(thread.id);
    });
    if (readOnly) return node;
    const row = el("div", { class: "mg-row" });
    const verb = (action, label, quiet) => el("button", { type: "button", ...(quiet ? { class: "quiet" } : {}), text: label, onclick: () => act(action, { thread: thread.id }) });
    // A highlight's words take a comment or a question of their own.
    const onWords = (action) => () => { const picked = wordsOf(thread.id); if (picked) compose(action, picked); };
    const primary = bare ? [
      el("button", { type: "button", text: "Comment", onclick: onWords("comment") }),
      ...(choices.some((choice) => choice.action === "ask") ? [el("button", { type: "button", text: "Ask", onclick: onWords("ask") })] : []),
      verb(kept ? "unkeep" : "keep", kept ? "Unkeep" : "Keep"),
      verb("resolve", "Remove", true),
    ] : [
      el("button", { type: "button", text: "Reply", onclick: () => replyIn(node, thread, row) }),
      verb(earlier ? "back" : "seen", earlier ? "Back" : "Seen"),
      verb(kept ? "unkeep" : "keep", kept ? "Unkeep" : "Keep"),
      el("button", { type: "button", text: "TL;DR", title: face ? "edit the TL;DR" : "ask @margin for a TL;DR", onclick: () => (face || !agent ? editTldr(node, thread, face || { body: "" }, row) : act("tldr", { thread: thread.id })) }),
    ];
    // ⋯: the rest (Edit its words where this page may, PIE-763; Quote, and Pick for several), in the same row instead, so the row never wraps.
    const edit = thread.edit ? [el("button", { type: "button", class: "quiet", text: "Edit", onclick: () => editIn(node, thread, row) })] : [];
    const rest = [...edit, ...quoteButtons(thread.id).slice(0, bare ? 1 : undefined)];
    const more = el("button", { type: "button", class: "quiet", text: "⋯", "aria-label": `more: ${thread.edit ? "edit, " : ""}quote, pick`, onclick: () => { row.replaceChildren(...rest, back); } });
    const back = el("button", { type: "button", class: "quiet", text: "‹", "aria-label": "back", onclick: () => { row.replaceChildren(...primary, more); } });
    row.append(...primary, more);
    node.append(row);
    return node;
  }

  /** The TL;DR edited (his own words over @margin's): a new one, the newest is the face. */
  function editTldr(node, thread, face, row) {
    if (!opening()) return;
    const input = el("textarea", { class: "mg-in" });
    input.value = face.body;
    editor = input;
    const why = el("p", { class: "why", hidden: "" });
    const box = el("div", { class: "mg-reply" }, input, why);
    const done = () => { box.remove(); row.hidden = false; editor = null; doneWriting(); };
    const cancel = el("button", { type: "button", class: "quiet", text: "Cancel", onclick: () => done() });
    const save = el("button", { type: "button", text: "Save", onclick: () =>
      submit(input, [save, cancel], why, { action: "tldr", thread: thread.id, body: input.value, requestId: requestId() }, (answer) => { say(answer.said || "saved"); done(); }) });
    box.append(el("div", { class: "mg-row" }, cancel, save));
    row.hidden = true;
    node.append(box);
    input.focus();
  }

  /** The cards of the marks on a card's words, under them: a highlight's opens when its words are tapped. */
  function nest(marks) {
    return marks.length ? el("div", { class: "mg-nest" }, ...marks.map((mark) => card(mark, false))) : null;
  }

  // ---- Quoting marks into a block of their own.

  const picked = new Set();
  const pickBar = el("div", { id: "mg-pick", class: "mg-ui", hidden: "" });
  document.body.append(pickBar);

  /** Pick or unpick a mark to quote with others; the bar along the bottom quotes them together. */
  function pick(id) {
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    for (const button of document.querySelectorAll("button[data-pick]")) {
      const on = picked.has(button.dataset.pick);
      button.classList.toggle("on", on);
      button.textContent = on ? "Picked" : "Pick";
    }
    for (const node of document.querySelectorAll(".mg-card[data-thread], .reply[data-reply]")) node.classList.toggle("picked", picked.has(node.dataset.thread || node.dataset.reply));
    pickBar.replaceChildren(
      el("button", { type: "button", class: "quiet", text: "Clear", onclick: () => { for (const id of [...picked]) pick(id); } }),
      el("button", { type: "button", text: `Quote ${picked.size}`, onclick: () => quote([...picked]) }),
    );
    pickBar.hidden = !picked.size;
  }

  /** The sheet that quotes marks: where the new block goes, and words of your own. */
  function quote(ids) {
    if (!ids.length || !opening()) return;
    hideBar();
    let place = "inbox", under = "", findTimer = 0, finds = 0;
    // One request id for this sheet: a retry after a lost answer gets the first quote back, not a second one.
    const id = requestId();
    const input = el("textarea", { class: "mg-in", placeholder: "Your own words above the quote (optional: its first line is its title)" });
    editor = input;
    const why = el("p", { class: "why", hidden: "" });
    const chosen = el("p", { class: "q", hidden: "" });
    const found = el("div", { class: "found", hidden: "" });
    const find = el("input", { class: "mg-find", type: "search", placeholder: "Find the note to put it under", hidden: "" });
    const places = [["inbox", "Inbox"], ["note", "Under its note"], ["under", "Under…"]].map(([name, label]) =>
      el("button", { type: "button", class: name === place ? "on" : "", text: label, onclick: () => choosePlace(name) }));
    function choosePlace(name) {
      place = name;
      places.forEach((button, at) => button.classList.toggle("on", ["inbox", "note", "under"][at] === name));
      find.hidden = name !== "under";
      found.hidden = name !== "under" || !found.childElementCount;
      chosen.hidden = name !== "under" || !under;
      if (name === "under") find.focus();
    }
    find.addEventListener("input", () => {
      clearTimeout(findTimer);
      const asked = ++finds;
      findTimer = setTimeout(async () => {
        const words = find.value.trim();
        if (words.length < 2) { found.replaceChildren(); found.hidden = true; return; }
        try {
          const response = await fetch(`${api}/find?${new URLSearchParams({ q: words, page })}`, { cache: "no-store" });
          const notes = response.ok ? (await response.json()).notes || [] : [];
          // An answer to words since changed is dropped: the list is always for what's typed now.
          if (asked !== finds) return;
          found.replaceChildren(...(notes.length ? notes.map((note) => el("button", { type: "button", class: "quiet", text: note.path ? `${note.title} · ${note.path}` : note.title, onclick: () => {
            under = note.id;
            chosen.textContent = `Under “${note.title}”`;
            chosen.hidden = false;
          } })) : [el("p", { class: "q", text: "no note by those words" })]));
          found.hidden = false;
        } catch {
          found.replaceChildren(el("p", { class: "q", text: "the search didn't answer" }));
          found.hidden = false;
        }
      }, 250);
    });
    const close = () => { sheet.remove(); editor = null; doneWriting(); };
    const cancel = el("button", { type: "button", class: "quiet", text: "Cancel", onclick: () => close() });
    const go = el("button", { type: "button", text: "Quote", onclick: () => {
      if (place === "under" && !under) { why.textContent = "Find the note to put it under first, and pick it."; why.hidden = false; return; }
      submit(input, [go, cancel, ...places], why, { action: "quote", marks: ids, place, ...(place === "under" ? { under } : {}), text: input.value, requestId: id }, (answer) => {
        for (const id of ids) if (picked.has(id)) pick(id);
        close();
        quoted(answer);
      });
    } });
    const sheet = el("div", { id: "mg-sheet", class: "mg-ui" },
      el("p", { class: "q", text: ids.length === 1 ? "Quote this into a block of its own" : `Quote these ${ids.length} into a block of their own` }),
      el("div", { class: "places" }, ...places), find, found, chosen, input, why,
      el("div", { class: "mg-row" }, cancel, go));
    document.body.append(sheet);
    input.focus();
  }

  /** A quote landed: said, with its page and an Undo. */
  function quoted(answer) {
    const after = [];
    if (answer.href) after.push(el("a", { href: answer.href, text: "Open" }));
    if (answer.undo) after.push(el("button", { type: "button", class: "quiet", text: "Undo", onclick: async () => {
      toast.hidden = true;
      sending += 1;
      try { say((await send({ action: "undo", undo: answer.undo })).said || "undone"); }
      // Not undone: said, with Undo still there to try again.
      catch (error) { say(`Not undone: ${error.message}`, ...after); }
      finally { sending -= 1; doneWriting(); }
    } }));
    say(answer.said || "quoted", ...after);
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
    // A mark on a card's words is a card in that card's nest: it and the cards around it open too.
    for (let inner = node; inner && !inner.classList.contains("top"); inner = inner.parentElement?.closest(".mg-card")) inner.classList.add("open");
    activate(node.closest(".mg-card.top")?.dataset.thread || wanted);
    markRead(wanted);
    node.scrollIntoView({ block: "center" });
  }
  window.addEventListener("hashchange", () => { arrived = false; arrive(); });

  /** "edited", or who edited it when that isn't who wrote it (PIE-763). */
  const editedSaid = (item) => (!item.edited ? "" : item.editedBy && item.editedBy !== item.by ? `edited by ${item.editedBy}` : "edited");

  /**
   * A posted comment's or reply's words edited in the box a reply is written in (PIE-763): its words as written, Save
   * sends them with the revision the edit started from, so an edit made meanwhile is refused and the words stay here.
   */
  function editIn(node, item, row) {
    if (!opening() || !item.edit) return;
    const input = el("textarea", { class: "mg-in", "aria-label": "Edit the words" });
    input.value = item.edit.words;
    editor = input;
    const why = el("p", { class: "why", hidden: "" });
    const box = el("div", { class: "mg-reply mg-edit" }, input, why);
    const done = () => { box.remove(); row.hidden = false; editor = null; doneWriting(); };
    const cancel = el("button", { type: "button", class: "quiet", text: "Cancel", onclick: () => done() });
    const save = el("button", { type: "button", text: "Save", onclick: () =>
      submit(input, [save, cancel], why, { action: "edit", mark: item.id, revision: item.edit.revision, body: input.value }, (answer) => { say(answer.said || "edited"); done(); }) });
    box.append(el("div", { class: "mg-row" }, cancel, save));
    row.hidden = true;
    row.after(box);
    completing(input);
    input.focus();
  }

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
    completing(input);
    input.focus();
  }

  const markOf = (id) => article()?.querySelector(`mark.ann[data-ann="${CSS.escape(id)}"]`);
  /** Every piece of a mark: a passage across markup is marked in pieces, each with the same id. */
  const marksOf = (id) => [...(article()?.querySelectorAll(`mark.ann[data-ann="${CSS.escape(id)}"]`) || [])];
  const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table";
  /** The thread whose card is open (the one the reader tapped, or arrived at), kept across redraws. */
  let active = null;

  /** A mark's words as a selection of them would say them: the drawn words and those either side. */
  function wordsOf(id) {
    const pieces = marksOf(id);
    if (!pieces.length) return null;
    const range = document.createRange();
    range.setStartBefore(pieces[0]);
    range.setEndAfter(pieces[pieces.length - 1]);
    const { before, inside, after } = around(range);
    const quote = inside.trim();
    return quote ? { quote, prefix: before.slice(-64), suffix: after.slice(0, 64) } : null;
  }

  /** Marks `range` in the article, one `<mark>` per text node it covers (a range across markup stays well formed). */
  function markRange(range, { kind, tone, id, placed }) {
    const walker = document.createTreeWalker(range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    const pieces = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node) || node.parentElement?.closest(".mg-card, .mg-whole")) continue;
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (to > from && /\S/.test(node.nodeValue.slice(from, to))) pieces.push([node, from, to]);
    }
    for (const [node, from, to] of pieces.reverse()) {
      const piece = document.createRange();
      piece.setStart(node, from);
      piece.setEnd(node, to);
      piece.surroundContents(el("mark", { class: `ann ann-${tone}`, ...(id ? { "data-ann": id } : {}), "data-kind": kind, "data-placed": placed }));
    }
  }

  /** The article's words for finding a quote: lower case, spaces folded, Markdown's marks left out, each mapped to where it's drawn. */
  const fold = (text) => text.replace(/[*_`\[\]]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  function readable() {
    const walker = document.createTreeWalker(article(), NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest(".mg-card, .mg-whole, aside.margin-note") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let text = "";
    const at = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue || "";
      for (let offset = 0; offset < value.length; offset += 1) {
        let character = value[offset];
        if (/[*_`\[\]]/.test(character)) continue;
        if (/\s/.test(character)) { if (!text || text.endsWith(" ")) continue; character = " "; }
        // One entry per character written: a letter that lower-cases to two (İ) maps both to where it's drawn.
        for (const unit of character.toLowerCase()) { text += unit; at.push([node, offset]); }
      }
    }
    return { text, at };
  }

  /**
   * A thread the page didn't mark (its words were found in the note's source, but the page draws them otherwise: an
   * embed, a link, a note drawn again since) is placed by its words in the page: exactly, else by its opening or closing
   * words. Placed, it's marked like any other; not, its card goes to the foot of the note, said "couldn't place".
   */
  function placeByWords(thread) {
    const wanted = fold(thread.quote || "");
    if (!wanted) return false;
    const { text, at } = readable();
    let start = text.indexOf(wanted), length = wanted.length;
    if (start < 0 && wanted.length > 48) {
      const head = text.indexOf(wanted.slice(0, 40)), tail = text.indexOf(wanted.slice(-40));
      if (head >= 0) { start = head; length = Math.min(wanted.length, text.length - head); }
      else if (tail >= 0) { start = Math.max(0, tail + 40 - wanted.length); length = tail + 40 - start; }
    }
    if (start < 0 || !at[start] || !at[start + length - 1]) return false;
    const range = document.createRange();
    range.setStart(at[start][0], at[start][1]);
    range.setEnd(at[start + length - 1][0], at[start + length - 1][1] + 1);
    markRange(range, { kind: thread.kind, tone: thread.tone || "default", id: thread.id, placed: "words" });
    return true;
  }

  /** A line's words with Blockdown's marks left out (`**`, `_`, code ticks, `[[ ]]`), for a one-line row. */
  const lineWords = (text) => text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2").replace(/\[\[|\]\]/g, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

  /** One line of the note's index of threads: what it is and its first words; tapping opens its card where it is. */
  function indexRow(thread, placed) {
    const said = lineWords(thread.body || (thread.quote ? `“${thread.quote}”` : ""));
    return el("li", {}, el("button", { type: "button", class: "quiet", onclick: () => { activate(thread.id); document.querySelector(`.mg-card.top[data-thread="${CSS.escape(thread.id)}"]`)?.scrollIntoView({ block: "center" }); } },
      el("span", { class: "k", text: `${thread.kind}${thread.replies.length ? ` · ${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}` : ""}${placed ? "" : thread.quote ? " · couldn't place" : ""}` }),
      el("span", { class: "x", text: said.length > 140 ? `${said.slice(0, 139)}…` : said })));
  }

  /**
   * The margin's setting (PIE-791), this reader's own (kept in this browser): `current` (the default: open and kept
   * threads, TL;DR faces; seen ones on the Earlier shelf at the foot), `all` (the seen ones in the margin too), or `off`
   * (no cards: the marks stay on the words, and the foot lists every thread).
   */
  const MARGINS = ["off", "current", "all"];
  let marginSetting = (() => { try { const kept = localStorage.getItem("ep0ch-margin"); return MARGINS.includes(kept) ? kept : "current"; } catch { return "current"; } })();
  function setMargin(value) {
    marginSetting = value;
    try { localStorage.setItem("ep0ch-margin", value); } catch { /* this page only */ }
    draw();
  }

  /** The Earlier shelf's rows opened in place. */
  const shelfOpen = new Set();

  /** One line of the Earlier shelf: what it was and its first words; tapping opens it in place, under the line. */
  function shelfRow(thread) {
    const said = lineWords(thread.body || (thread.quote ? `“${thread.quote}”` : ""));
    const item = el("li", { class: "earlier" });
    const show = () => {
      const node = card(thread, true);
      node.classList.add("on", "inplace");
      item.append(node);
      line.setAttribute("aria-expanded", "true");
    };
    const line = el("button", { type: "button", class: "quiet", "aria-expanded": "false", onclick: () => {
      const open = item.querySelector(".mg-card");
      // Something being written in it stays until it's sent or cancelled.
      if (open && editor && open.contains(editor)) { say("finish or cancel what you're writing first"); editor.focus(); return; }
      if (open) { open.remove(); shelfOpen.delete(thread.id); line.setAttribute("aria-expanded", "false"); return; }
      shelfOpen.add(thread.id);
      show();
      markRead(thread.id);
    } },
    el("span", { class: "k", text: `${thread.kind}${isEarlier(thread) ? ` · ${thread.lifecycle}` : ""}${thread.replies.length ? ` · ${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}` : ""}` }),
    el("span", { class: "x", text: said.length > 140 ? `${said.slice(0, 139)}…` : said }));
    item.append(line);
    // Opened, it stays open while the page is drawn again (an answer landing, another card's action).
    if (shelfOpen.has(thread.id)) show();
    return item;
  }

  let watching = null;
  function draw() {
    if (busy()) return;
    const host = article();
    if (!host) return;
    // The page's own asides were for readers without the script: the cards replace them. Marks placed here by words
    // are placed again (their thread may have gone, or the server may mark it now).
    for (const old of document.querySelectorAll(".mg-card, .mg-whole, aside.margin-note")) old.remove();
    for (const old of host.querySelectorAll('mark[data-placed="words"]')) old.replaceWith(...old.childNodes);
    host.normalize();
    margin.replaceChildren();
    main.dataset.margin = marginSetting;
    const whole = [], lost = [], rows = [], shelf = [];
    for (const thread of threads) {
      // The service's place, drawn by the page or found by its words here; one it couldn't place isn't looked for (PIE-805).
      const placed = !!markOf(thread.id) || (!thread.unplaced && placeByWords(thread));
      // Put away: on the Earlier shelf, unless the margin shows all.
      if (isEarlier(thread) && marginSetting !== "all") { shelf.push(shelfRow(thread)); continue; }
      // Off: no cards; each thread opens in place from the foot's index, as the shelf's do.
      if (marginSetting === "off") { rows.push(shelfRow(thread)); continue; }
      rows.push(indexRow(thread, placed || !thread.quote));
      const node = card(thread, true);
      if (thread.id === active) node.classList.add("on");
      if (!placed) { (thread.quote ? lost : whole).push(node); continue; }
      if (wide.matches) margin.append(node);
      else {
        // Under its passage: after the paragraph (or list item) the words are in, after any cards already there.
        let at = markOf(thread.id).closest(BLOCKS) || markOf(thread.id);
        while (at.nextElementSibling && at.nextElementSibling.classList.contains("mg-card")) at = at.nextElementSibling;
        at.after(node);
      }
    }
    for (const node of marksOf(active || "")) node.classList.add("on");
    // The margin's setting is a bar held at the bottom of the window (PIE-800), so a long page doesn't hide it at its
    // foot: the last thing in the page, it sits there once the page is read to its end.
    main.querySelector(":scope > .mg-margin-bar")?.remove();
    if (threads.length) {
      main.append(el("div", { class: "mg-margin-bar mg-ui" }, el("div", { class: "mg-setting", role: "group", "aria-label": "the margin" }, el("span", { class: "who", text: "margin" }),
        ...MARGINS.map((value) => el("button", { type: "button", class: value === marginSetting ? "on" : "quiet", "aria-pressed": String(value === marginSetting), text: value, onclick: () => setMargin(value) })))));
    }
    // The foot of the note: every current thread (the index), the Earlier shelf, the note's own comments, and any card
    // that couldn't be placed. With the shelf, the index is every thread on the note.
    const foot = el("div", { class: "mg-whole mg-ui" });
    if (threads.length) {
      if (rows.length) foot.append(el("h2", { text: `On this note · ${rows.length}` }), el("ul", { class: "mg-index" }, ...rows));
      if (shelf.length) foot.append(el("h2", { text: `Earlier · ${shelf.length}` }), el("ul", { class: "mg-index mg-shelf" }, ...shelf));
    }
    foot.append(...whole);
    if (lost.length) foot.append(el("h2", { text: "Couldn't place" }), el("p", { class: "who", text: "Their words aren't on the page as it's drawn now." }), ...lost);
    if (readOnly) foot.append(el("div", { class: "who", text: readOnly }));
    else if (choices.some((choice) => choice.action === "comment")) {
      foot.append(el("div", { class: "mg-row" }, el("button", { type: "button", class: "quiet", text: "Comment on this note", onclick: () => compose("comment", null) })));
    }
    host.append(foot);
    formatTimes(main);
    // A picture loading, a fold opening or the window narrowing moves the words: the cards follow.
    watching?.disconnect();
    watching = new ResizeObserver(() => place());
    watching.observe(host);
    place();
    arrive();
    arriveAtLine();
  }

  /** Opens one thread's card (and lights its words); the others rest. */
  function activate(id) {
    active = id;
    for (const node of document.querySelectorAll(".mg-card.top")) node.classList.toggle("on", node.dataset.thread === id);
    for (const node of document.querySelectorAll("mark.ann.on")) node.classList.remove("on");
    for (const node of marksOf(id || "")) node.classList.add("on");
    place();
    if (id) markRead(id);
  }

  const leader = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leader.id = "mg-leader";
  leader.setAttribute("aria-hidden", "true");
  main.append(leader);

  /**
   * Wide: each card level with its words. The open card stays at its words; the ones above it move up and the ones
   * below it down, as little as keeps them apart. A line runs from the open card's words to it.
   */
  function place() {
    leader.replaceChildren();
    if (!wide.matches) return;
    const top = margin.getBoundingClientRect().top;
    const items = [...margin.children].filter((node) => getComputedStyle(node).display !== "none").map((node) => {
      const mark = markOf(node.dataset.thread);
      return { node, want: mark ? mark.getBoundingClientRect().top - top - 2 : 0, height: node.offsetHeight };
    }).sort((a, b) => a.want - b.want);
    const gap = 8, at = items.findIndex((item) => item.node.dataset.thread === active);
    if (at < 0) items.forEach((item, index) => { item.top = index ? Math.max(item.want, items[index - 1].top + items[index - 1].height + gap) : item.want; });
    else {
      items[at].top = items[at].want;
      for (let index = at - 1; index >= 0; index -= 1) items[index].top = Math.min(items[index].want, items[index + 1].top - items[index].height - gap);
      for (let index = at + 1; index < items.length; index += 1) items[index].top = Math.max(items[index].want, items[index - 1].top + items[index - 1].height + gap);
    }
    let floor = 0;
    for (const item of items) {
      item.top = Math.max(item.top, floor);
      floor = item.top + item.height + gap;
      item.node.style.top = `${item.top}px`;
    }
    margin.style.minHeight = `${floor}px`;
    const open = items[at];
    const mark = open && markOf(active);
    if (!mark) return;
    const box = main.getBoundingClientRect(), words = mark.getClientRects()[0] || mark.getBoundingClientRect();
    const column = article().getBoundingClientRect(), side = margin.getBoundingClientRect();
    const x1 = column.right - box.left + 6, x2 = side.left - box.left - 2;
    const y1 = words.top - box.top + Math.min(words.height, 26) / 2, y2 = side.top - box.top + open.top + 14;
    const bend = x1 + (x2 - x1) * 0.5;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", Math.abs(y2 - y1) < 2 ? `M${x1} ${y1}H${x2}` : `M${x1} ${y1}H${bend}V${y2}H${x2}`);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(x1)); dot.setAttribute("cy", String(y1)); dot.setAttribute("r", "2.5");
    leader.append(path, dot);
  }

  // Tapping a mark opens its card (a bare highlight's only way in: remove it, comment or ask on its words).
  document.addEventListener("click", (event) => {
    const mark = event.target instanceof Element ? event.target.closest("mark.ann[data-ann]") : null;
    if (!mark || !window.getSelection()?.isCollapsed) return;
    const id = mark.dataset.ann;
    activate(active === id ? null : id);
    if (active) document.querySelector(`.mg-card.top[data-thread="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  });
  // ---- Steps (PIE-811): a checklist step's box opens its choices; the one chosen lands as the step's new status
  // (`checklist.update`, checked against the step as this page drew it), then the note is drawn again. The keys are the
  // door's: x done, o to do, + approve, - reject, w waiting, ! problem; arrows move, Esc closes.

  const STEP_CHOICES = [["done", "Mark done", "x"], ["todo", "Mark to do", "o"], ["approved", "Approve", "+"], ["rejected", "Reject", "-"], ["waiting", "Mark waiting", "w"], ["problem", "Mark problem", "!"]];
  let stepMenu = null;
  function closeStepMenu(back) {
    if (!stepMenu) return;
    const { node, box } = stepMenu;
    stepMenu = null;
    node.remove();
    if (back && box.isConnected) box.focus();
  }
  function openStepMenu(box) {
    closeStepMenu();
    if (readOnly) { say(readOnly); return; }
    const items = STEP_CHOICES.map(([status, label, key]) => el("button", {
      type: "button", role: "menuitem", "data-status": status, "aria-keyshortcuts": key, text: `${label}  ${key}`,
      ...(box.dataset.stepStatus === status ? { "aria-current": "true" } : {}), onclick: () => setStep(box, status),
    }));
    const node = el("div", { class: "step-menu mg-ui", role: "menu", "aria-label": "the step's status" }, ...items);
    node.addEventListener("keydown", (event) => {
      const at = items.indexOf(document.activeElement);
      if (event.key === "Escape") { event.preventDefault(); closeStepMenu(true); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
        return;
      }
      const chosen = STEP_CHOICES.find(([, , key]) => key === event.key);
      if (chosen) { event.preventDefault(); setStep(box, chosen[0]); }
    });
    document.body.append(node);
    const rect = box.getBoundingClientRect(), room = document.documentElement.clientWidth;
    node.style.left = `${window.scrollX + Math.max(8, Math.min(rect.left, room - node.offsetWidth - 8))}px`;
    node.style.top = `${window.scrollY + rect.bottom + 4}px`;
    stepMenu = { node, box };
    (items.find((item) => item.dataset.status !== box.dataset.stepStatus) || items[0]).focus();
  }
  /** The step's box as the page draws it now: by its id (a first change gives it one), else by its place among the page's steps. */
  const stepBox = (id, at) => (id && document.querySelector(`button.step[data-step-id="${CSS.escape(id)}"]`)) || document.querySelectorAll("button.step[data-step-block]")[at];
  async function setStep(box, status, undoable) {
    // Where the reader was: the step by its id (a first change gives it one), else by its place among the page's steps.
    const at = [...document.querySelectorAll("button.step[data-step-block]")].indexOf(box);
    let id = box.dataset.stepId || "";
    const was = box.dataset.stepStatus;
    sending += 1;
    try {
      const answer = await send({
        action: "step", status, block: box.dataset.stepBlock, evidence: box.dataset.stepEvidence,
        ...(box.dataset.stepId ? { itemId: box.dataset.stepId } : { start: Number(box.dataset.stepStart), revision: Number(box.dataset.stepRevision) }),
        // A live figure's row (PIE-864): the property its figure's done: names, written to the row's own note.
        ...(box.dataset.stepNote ? { live: { note: box.dataset.stepNote, from: box.dataset.stepStatus, figure: Number(box.dataset.stepFigure), revision: Number(box.dataset.stepRevision) } } : {}),
      });
      id = answer.itemId || id;
      // A tap's tick undoes from the page (PIE-1235): the step set back as it was, the same way.
      if (undoable && answer.changed !== false && was) {
        say(answer.said, " ", el("button", { type: "button", class: "quiet", text: "Undo", onclick: () => {
          const again = stepBox(id, at);
          if (again instanceof HTMLElement) setStep(again, was, false);
        } }));
      } else say(answer.said);
    } catch (error) {
      // Said, and the note drawn again: the reader chooses again on the step as it is now.
      say(error.message);
    } finally {
      closeStepMenu(false);
      sending -= 1;
    }
    // The note drawn again, and the reader's place kept: focus back on the step's new box.
    await refresh().catch(() => {});
    draw();
    const again = stepBox(id, at);
    if (again instanceof HTMLElement) again.focus({ preventScroll: true });
    wake();
  }
  // On a phone (PIE-1235) a tap ticks a step (to do and done swap, with Undo in the toast) and a long press opens its
  // choices; a step that's approved, rejected, waiting or a problem opens them on a tap too, since a tick would lose that.
  // A mouse's click opens the choices, as the door's does.
  let pointer = "mouse", held = 0, heldBox = null;
  const stepAt = (event) => event.target instanceof Element ? event.target.closest("button.step[data-step-block]") : null;
  document.addEventListener("pointerdown", (event) => {
    pointer = event.pointerType || "mouse";
    clearTimeout(held);
    heldBox = null;
    const box = stepAt(event);
    if (!box || pointer === "mouse") return;
    held = setTimeout(() => { heldBox = box; openStepMenu(box); }, 500);
  }, true);
  for (const type of ["pointerup", "pointercancel", "scroll"]) document.addEventListener(type, () => clearTimeout(held), { capture: true, passive: true });
  document.addEventListener("contextmenu", (event) => { if (stepAt(event)) event.preventDefault(); });
  document.addEventListener("click", (event) => {
    const box = stepAt(event);
    if (box) {
      event.preventDefault();
      // The long press already opened the choices: its click leaves them open.
      if (heldBox === box) { heldBox = null; return; }
      if (stepMenu?.box === box) { closeStepMenu(true); return; }
      const status = box.dataset.stepStatus;
      if (pointer !== "mouse" && (status === "todo" || status === "done") && !readOnly) { closeStepMenu(false); setStep(box, status === "done" ? "todo" : "done", true); return; }
      openStepMenu(box);
      return;
    }
    if (stepMenu && !(event.target instanceof Element && event.target.closest(".step-menu"))) closeStepMenu(false);
  });

  // ---- One tap, one item (PIE-1235): on a phone, selecting words is fiddly, so a tap on a list item, a paragraph or a
  // table's row selects its own words, as a selection would; the bar then offers Comment and the rest, and the comment
  // is the same passage record a selection makes, drawn in its place in the door's margin too. A second tap lets go.
  const ITEM = "li, p, td, th, blockquote, dd, dt, h1, h2, h3, h4, h5, h6";
  const SKIP = "a, button, input, textarea, select, label, summary, mark.ann, .mg-ui, .mg-card, aside, pre, code, .sources-panel";
  let tapped = null;
  /** The item's own words as a range: a list item stops before the list nested in it. */
  function itemRange(item) {
    const range = document.createRange();
    range.selectNodeContents(item);
    const nested = item.tagName === "LI" ? [...item.children].find((kid) => kid.tagName === "UL" || kid.tagName === "OL") : null;
    if (nested) range.setEndBefore(nested);
    return range;
  }
  document.addEventListener("click", (event) => {
    if (pointer === "mouse" || readOnly || busy() || !(event.target instanceof Element)) return;
    const host = article();
    const item = host && host.contains(event.target) && !event.target.closest(SKIP) ? event.target.closest(ITEM) : null;
    const selection = window.getSelection();
    if (!item || !host.contains(item) || !selection) { tapped = null; return; }
    if (tapped === item && !selection.isCollapsed) { tapped = null; selection.removeAllRanges(); hideBar(); return; }
    // A selection the reader made themselves (a long press) is theirs.
    if (!selection.isCollapsed && tapped !== item && readSelection()) return;
    // A table's row is the item, not the one cell tapped.
    const range = itemRange(item.closest("tr") || item);
    if (!range.toString().trim()) return;
    selection.removeAllRanges();
    selection.addRange(range);
    tapped = item;
  });

  // Tapping words marked in a card opens that mark's card, in the nest under them.
  document.addEventListener("click", (event) => {
    const mark = event.target instanceof Element ? event.target.closest("mark.ann[data-sub]") : null;
    if (!mark || !window.getSelection()?.isCollapsed) return;
    const node = document.querySelector(`.mg-card[data-thread="${CSS.escape(mark.dataset.sub)}"]`);
    if (!node) return;
    node.classList.toggle("open");
    place();
    markRead(mark.dataset.sub);
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
    readOnly = data.readOnly || "";
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
  let lineArrival = null;
  function pointAt(node, place = node) {
    if (pointed) pointed.classList.remove("ep0ch-pointed");
    clearTimeout(pointTimer);
    node.classList.add("ep0ch-pointed");
    pointed = node;
    pointTimer = setTimeout(() => { node.classList.remove("ep0ch-pointed"); if (pointed === node) pointed = null; }, 5000);
    place.scrollIntoView({ block: "center", behavior: "auto" });
  }
  // Fragment ids are generated from the service's original source, before links and decorations change it.
  function arriveAtLine() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    if (!id || id.startsWith("thread=") || lineArrival === id) return;
    let marker = document.getElementById(id);
    // Work-id and property backlinks use the same source offsets; the nearest original line owns one.
    const at = /^at:(\d+)$/.exec(id);
    if (!marker && at) {
      marker = [...article().querySelectorAll('.line-anchor[id^="line:"]')]
        .filter(node => Number(node.id.slice(5)) <= Number(at[1]))
        .sort((a, b) => Number(b.id.slice(5)) - Number(a.id.slice(5)))[0];
    }
    if (!marker || !article()?.contains(marker) || !marker.classList.contains("line-anchor")) return;
    for (let parent = marker.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
    lineArrival = id;
    pointAt(marker.parentElement, marker);
  }
  window.addEventListener("hashchange", () => { lineArrival = null; arriveAtLine(); });
  arriveAtLine();

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
    pointAt(node);
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
    {
      name: "trail", args: [],
      description: "Where this tab has been: the notes it opened, newest first, each once (blockId, title, at), the list the breadcrumbs' ≡ trail opens. Never writes.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      did: () => "an agent is reading where you've been",
      run: async () => {
        try { await report(); } catch { /* the trail as the page last had it */ }
        return { stops: (seen && seen.trail) || [] };
      },
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
