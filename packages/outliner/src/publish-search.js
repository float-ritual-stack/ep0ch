// The web client's search box (PIE-789), served by the publisher at `<base>/_marginalia/search.js` on every tailnet and
// share page that has the box. The box is a plain GET form to `<base>/search` and works without this script; this adds:
//
// - `/` or ctrl+k (cmd+k) anywhere outside a text box opens it, as the door's power bar opens;
// - results as you type, from the same route (`?format=json`, the service's one search from this page's note), the
//   title, the matching line and the crumbs; up/down choose, Enter opens the chosen one (none chosen: the results
//   page), Esc closes;
// - on a phone, open, the box is a sheet over the page with a Cancel button.
//
// Dark throughout, no animation (Evan is photosensitive). Plain DOM, no build, no eval: results come as data and are set
// as text, the matched words in bold.
(() => {
  "use strict";
  const form = document.querySelector("form.sx");
  if (!form) return;
  const input = form.querySelector("input[name=q]");
  const near = form.querySelector("input[name=near]");
  if (!input) return;
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
  const panel = el("div", { class: "sx-panel", id: "sx-results", hidden: "" });
  const close = el("button", { type: "button", class: "sx-close", text: "Cancel", hidden: "", onclick: () => shut() });
  form.querySelector(".sx-row").append(close);
  form.append(panel);
  input.setAttribute("aria-controls", "sx-results");
  const phone = window.matchMedia("(max-width: 40rem)");

  let asked = "";
  let timer = 0;
  let chosen = -1;
  let rows = [];

  function open() {
    form.classList.add("open");
    close.hidden = !phone.matches;
    if (document.activeElement !== input) input.focus();
    if (input.value.trim()) look();
  }
  function shut() {
    form.classList.remove("open");
    close.hidden = true;
    panel.hidden = true;
    chosen = -1;
    input.blur();
  }

  /** Words with the matched ones in bold, as text nodes (never HTML). */
  function marked(text, terms) {
    const span = document.createDocumentFragment();
    const words = terms.filter(Boolean).sort((a, b) => b.length - a.length).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const parts = words.length ? text.split(new RegExp(`(${words.join("|")})`, "giu")) : [text];
    parts.forEach((part, index) => span.append(index % 2 ? el("b", { text: part }) : document.createTextNode(part)));
    return span;
  }

  function draw(answer) {
    chosen = -1;
    rows = answer.hits;
    if (!answer.query) { panel.hidden = true; return; }
    const list = el("ul", { class: "kids", role: "listbox" });
    answer.hits.forEach((hit, index) => {
      const link = el("a", { href: hit.href, role: "option", id: `sx-${index}` },
        el("span", { class: "t" }, marked(hit.title, answer.terms)),
        hit.line ? el("span", { class: "s" }, marked(hit.line, answer.terms)) : null);
      list.append(el("li", {}, link, hit.crumbs ? el("span", { class: "m", text: hit.crumbs }) : null));
    });
    const said = answer.hits.length ? null : el("p", { class: "dim", text: `Nothing matches “${answer.query}”.` });
    panel.replaceChildren(...(answer.hits.length ? [list] : []), said ?? "");
    panel.hidden = false;
  }

  function choose(index) {
    const items = panel.querySelectorAll("li");
    items.forEach((item, at) => item.classList.toggle("on", at === index));
    chosen = index;
    const item = items[index];
    if (item) { item.scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", `sx-${index}`); }
    else input.removeAttribute("aria-activedescendant");
  }

  async function look() {
    const query = input.value.trim();
    if (query === asked && !panel.hidden) return;
    asked = query;
    if (!query) { draw({ query: "", hits: [], terms: [] }); return; }
    const params = new URLSearchParams({ q: query, format: "json" });
    if (near && near.value) params.set("near", near.value);
    try {
      const response = await fetch(`${form.action}?${params}`, { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`the search answered ${response.status}`);
      const answer = await response.json();
      // A slower answer to an older question is dropped.
      if (query === input.value.trim()) draw(answer);
    } catch (error) {
      panel.replaceChildren(el("p", { class: "dim", text: `The search didn't answer: ${error.message}. Enter opens the results page.` }));
      panel.hidden = false;
    }
  }

  input.addEventListener("focus", () => { if (phone.matches || input.value.trim()) open(); });
  input.addEventListener("input", () => {
    if (!form.classList.contains("open")) open();
    clearTimeout(timer);
    timer = setTimeout(look, 120);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); shut(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!rows.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      choose((chosen + step + rows.length) % rows.length);
      return;
    }
    if (event.key === "Enter" && chosen >= 0 && rows[chosen]) {
      event.preventDefault();
      location.href = rows[chosen].href;
    }
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const k = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k";
    if (k || (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      event.preventDefault();
      open();
      input.select();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (form.classList.contains("open") && !form.contains(event.target)) shut();
  });
})();
