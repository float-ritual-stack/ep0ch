// The door's page (publish-door.ts): one terminal attached to the outline's door session through ptyZZZ. Frames come
// in over SSE (a keyframe replaces the grid; a diff patches rows by id, appends and trims), and keys, paste, mouse and
// resize go out as ptyZZZ's JSONL commands. The key mapping, the composition surface and the send queue follow
// ptyZZZ's own serve.nu page (MIT); the mouse is its vendored adapter. A phone gets a toolbar of the keys its keyboard
// lacks, sticky ctrl and alt, a font size (A−/A+ or a pinch) and touch scrolling.
import { wirePtyMouse } from "./client.js";

const body = document.body;
const base = body.dataset.base || "";
const open = body.dataset.open || "";
const grid = () => document.getElementById("grid-door");
const term = document.getElementById("term");
const status = document.getElementById("status");
const showStats = new URLSearchParams(location.search).has("stats");
// A composer page (`/door/compose`): framed by a note's page as its comment box, which is told when the composer is
// up (its first frame) and when it ends (its exit code: 0 sent, 3 closed unsent, 2 refused), on this origin only.
const compose = body.hasAttribute("data-compose");
const tell = (what) => { if (compose && parent !== window) parent.postMessage({ ep0ch: "compose", t: id, ...what }, location.origin); };
let told = false;

// The terminal this page was given: each page (and each reload) is a terminal of its own; the last one ends on its own.
const id = body.dataset.t;

// Input: one POST in flight, the backlog batched behind it, so frames arrive in order.
const queue = [];
let sending = false;
async function drain() {
  if (sending) return;
  sending = true;
  while (queue.length) {
    const batch = queue.splice(0).join("\n") + "\n";
    try { await fetch(`${base}/door/input?t=${id}`, { method: "POST", body: batch, headers: { "content-type": "application/x-ndjson" } }); } catch {}
  }
  sending = false;
}
// Key-to-frame latency (?stats): the time from a key sent to the next frame received.
const latency = [];
let pendingKey = 0;
function send(frame) {
  if (frame.t === "key" || frame.t === "input" || frame.t === "paste") pendingKey ||= performance.now();
  queue.push(JSON.stringify(frame));
  drain();
}
window.doorLatency = latency;

// Sticky modifiers from the toolbar: they apply to the next key, then let go.
let sticky = 0;
function setSticky(bits) {
  sticky = bits;
  for (const b of document.querySelectorAll("#bar [data-mod]")) b.setAttribute("aria-pressed", String(!!(sticky & Number(b.dataset.mod))));
}
function sendKey(key, mods = 0) {
  send({ t: "key", key, mods: mods | sticky });
  if (sticky) setSticky(0);
}

const NAMED = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert", "Delete", "Enter", "Tab", "Backspace", "Escape"];
function keyEvent(ev) {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(ev.key)) return null;
  const mods = (ev.shiftKey ? 1 : 0) | (ev.altKey ? 2 : 0) | (ev.ctrlKey ? 4 : 0) | (ev.metaKey ? 8 : 0);
  if (ev.key.length === 1) {
    if (ev.metaKey) return null;
    if (ev.altKey && !ev.ctrlKey) {
      const letter = /^Key([A-Z])$/.exec(ev.code)?.[1]?.toLowerCase();
      if (!(letter && ev.key.toLowerCase() === letter)) return { key: ev.key, mods: mods & ~2 };
    }
    return { key: ev.key, mods };
  }
  if (NAMED.includes(ev.key) || /^F\d+$/.test(ev.key)) return { key: ev.key, mods };
  return null;
}

// The composition surface: dead keys, IME and a phone's keyboard type into a real (invisible) textarea.
const ta = document.createElement("textarea");
ta.setAttribute("aria-label", "door keyboard");
ta.autocapitalize = "off"; ta.autocomplete = "off"; ta.spellcheck = false;
ta.setAttribute("autocorrect", "off");
ta.style.cssText = "position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;padding:0;border:0;outline:0;resize:none;overflow:hidden;";
body.appendChild(ta);
let composing = false;
ta.addEventListener("compositionstart", () => { composing = true; });
ta.addEventListener("compositionend", ev => {
  composing = false;
  const data = ev.data || ta.value;
  ta.value = "";
  if (data) send({ t: "input", b: data });
});
// A phone's keyboard sends keydown 229 ("Unidentified") and the text arrives here instead.
ta.addEventListener("input", ev => {
  if (composing || ev.isComposing) return;
  const t = ev.inputType;
  if (t === "insertText" && ev.data) { for (const ch of ev.data) sendKey(ch); }
  else if (t === "insertLineBreak" || t === "insertParagraph") sendKey("Enter");
  else if (t === "deleteContentBackward") sendKey("Backspace");
  else if (t === "deleteContentForward") sendKey("Delete");
  ta.value = "";
});
function park() {
  requestAnimationFrame(() => {
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    try { ta.focus({ preventScroll: true }); } catch {}
  });
}
term.addEventListener("click", park);

addEventListener("keydown", ev => {
  if (ev.isComposing || ev.keyCode === 229 || composing) return;
  if (ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key === "c" && getSelection()?.toString()) {
    navigator.clipboard?.writeText(getSelection().toString()).catch(() => {});
    ev.preventDefault();
    return;
  }
  const k = keyEvent(ev);
  if (!k) return;
  if (document.activeElement !== ta) ta.focus({ preventScroll: true });
  ev.preventDefault();
  ta.value = "";
  sendKey(k.key, k.mods);
});
addEventListener("paste", ev => {
  const text = ev.clipboardData?.getData("text");
  if (!text) return;
  ev.preventDefault();
  send({ t: "paste", s: text });
});
document.addEventListener("copy", ev => {
  const text = getSelection()?.toString();
  if (!text) return;
  const trimmed = text.split("\n").map(l => l.replace(/[ \t]+$/, "")).join("\n");
  if (trimmed === text) return;
  ev.clipboardData?.setData("text/plain", trimmed);
  ev.preventDefault();
});

// The toolbar: a key, a sticky modifier, the font size, or the phone's keyboard.
document.getElementById("bar").addEventListener("click", ev => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.key) sendKey(b.dataset.key, Number(b.dataset.mods || 0));
  else if (b.dataset.mod) setSticky(sticky ^ Number(b.dataset.mod));
  else if (b.dataset.font) setFont(fontSize + Number(b.dataset.font));
  if (b.hasAttribute("data-kbd")) ta.focus();
  else park();
});

// The font size: A−/A+, or a pinch; remembered on this device. The terminal refits to it.
let fontSize = (() => { try { return Number(localStorage.getItem("door-fs")) || 0; } catch { return 0; } })() || (matchMedia("(pointer:coarse)").matches ? 11 : 14);
function setFont(px) {
  fontSize = Math.max(7, Math.min(28, Math.round(px)));
  document.documentElement.style.setProperty("--fs", `${fontSize}px`);
  try { localStorage.setItem("door-fs", String(fontSize)); } catch {}
  fitSoon();
}
let pinch = null;
term.addEventListener("touchstart", ev => {
  if (ev.touches.length === 2) pinch = { d: dist(ev.touches), fs: fontSize };
  else if (ev.touches.length === 1) swipe = { y: ev.touches[0].clientY, x: ev.touches[0].clientX, acc: 0 };
}, { passive: true });
term.addEventListener("touchmove", ev => {
  if (pinch && ev.touches.length === 2) { setFont(pinch.fs * dist(ev.touches) / pinch.d); ev.preventDefault(); return; }
  if (swipe && ev.touches.length === 1) {
    // A one-finger drag scrolls what's under it: wheel presses at the touch point, one per row dragged.
    const t = ev.touches[0];
    const h = cell().h;
    swipe.acc += swipe.y - t.clientY;
    swipe.y = t.clientY;
    const steps = Math.trunc(swipe.acc / h);
    if (steps) {
      swipe.acc -= steps * h;
      const at = cellAt(t.clientX, t.clientY);
      for (let i = 0; i < Math.min(Math.abs(steps), 10); i++) send({ t: "mouse", kind: "press", button: steps > 0 ? "wheeldown" : "wheelup", ...at, mods: 0 });
    }
    ev.preventDefault();
  }
}, { passive: false });
term.addEventListener("touchend", () => { pinch = null; swipe = null; });
let swipe = null;
const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

// Fit the terminal to the box: one cell measured from a probe in the grid's font.
function cell() {
  const g = grid();
  const probe = document.createElement("span");
  probe.textContent = "M".repeat(40);
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;line-height:1.2";
  g.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { w: r.width / 40 || 8, h: r.height || 16 };
}
function cellAt(x, y) {
  const c = cell(), r = grid().getBoundingClientRect();
  return { x: Math.max(0, Math.floor((x - r.left) / c.w)), y: Math.max(0, Math.floor((y - r.top) / c.h)) };
}
let size = null;
function measure() {
  const c = cell(), box = term.getBoundingClientRect();
  return { cols: Math.max(20, Math.floor(box.width / c.w)), rows: Math.max(5, Math.floor(box.height / c.h)) };
}
function fit() {
  const s = measure();
  if (size && s.cols === size.cols && s.rows === size.rows) return;
  size = s;
  send({ t: "resize", ...s });
}
let fitTimer = 0;
function fitSoon() { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 150); }
addEventListener("resize", fitSoon);
visualViewport?.addEventListener("resize", fitSoon);

// Frames: a keyframe replaces the grid; a diff applies only on the frame it was made against (`base`), else waits for
// the next keyframe (PROTOCOL.md).
let seqno = -1;
let frames = 0, bytes = 0;
const started = performance.now();
function apply(msg) {
  if (msg.t === "screen") {
    const t = document.createElement("template");
    t.innerHTML = msg.html;
    const next = t.content.firstElementChild;
    if (next) grid().replaceWith(next);
    seqno = msg.seqno;
  } else if (msg.t === "diff") {
    if (msg.base !== seqno) return;
    const g = grid();
    if (msg.patch) {
      const t = document.createElement("template");
      t.innerHTML = msg.patch;
      for (const el of [...t.content.children]) {
        const old = el.id && document.getElementById(el.id);
        if (old) old.replaceWith(el); else if (el.classList.contains("cursor")) g.prepend(el); else g.appendChild(el);
      }
    }
    if (msg.append) g.insertAdjacentHTML("beforeend", msg.append);
    for (const rid of msg.trim || []) document.getElementById(rid)?.remove();
    seqno = msg.seqno;
  } else if (msg.t === "exit") {
    ended = true;
    source?.close();
    status.textContent = compose ? (msg.code === 0 ? "sent" : "closed") : "the door ended · reload to call again";
    tell({ exit: msg.code });
    return;
  }
  if (compose && !told && /ctrl\+s|can't write/.test(grid().textContent || "")) { told = true; tell({ ready: performance.now() }); }
  if (pendingKey) { latency.push(performance.now() - pendingKey); pendingKey = 0; }
  if (showStats) {
    const sorted = [...latency].sort((a, b) => a - b);
    const med = sorted.length ? sorted[sorted.length >> 1].toFixed(0) : "–";
    const mins = (performance.now() - started) / 60000;
    status.textContent = `${med} ms · ${(bytes / 1024 / Math.max(mins, 1 / 60)).toFixed(0)} KB/min · ${frames} frames`;
  }
}

let source = null, ended = false;
function connect() {
  const s = measure();
  size = s;
  const q = new URLSearchParams({ t: id, cols: String(s.cols), rows: String(s.rows), ...(open ? { open } : {}) });
  const es = source = new EventSource(`${base}/door/stream?${q}`);
  es.onmessage = ev => {
    frames++;
    bytes += ev.data.length;
    try { apply(JSON.parse(ev.data)); } catch {}
  };
  // A refused reconnect (signed out, the terminal gone) closes it for good: say so rather than "reconnecting" forever.
  es.onerror = () => {
    if (ended) return;
    if (es.readyState === EventSource.CLOSED) { status.textContent = "disconnected (signed out, or the terminal ended) · reload"; tell({ lost: true }); }
    else if (!showStats) status.textContent = "reconnecting…";
  };
  es.onopen = () => { if (!showStats) status.textContent = ""; fitSoon(); };
}

wirePtyMouse({ root: term, send: (_pane, frame) => send(frame) });
setFont(fontSize);
document.fonts?.ready.then(fitSoon);
connect();
park();
