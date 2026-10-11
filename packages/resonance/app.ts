import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { arrange, shortestRoute, type Atlas } from "./model";
import { Resonator } from "./sound";

type Layout = "constellation" | "islands" | "chronology";
type Note = { record: BlockRecord; html: string; threads: unknown[] };
type Draft = { text: string; revision: number; base: string; stale: boolean };
type CommentDraft = { text: string; quote: string; revision: number };
type Args = Record<string, unknown>;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing instrument control: ${id}`);
  return element as T;
};
const input = (id: string) => $<HTMLInputElement>(id);
const textarea = (id: string) => $<HTMLTextAreaElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const svgNS = "http://www.w3.org/2000/svg";
const palette = ["#8bcec7", "#e79b86", "#b7b0da", "#d0bd8c", "#99ba9f", "#86b7d5"];
const sound = new Resonator();
const state = {
  atlas: null as Atlas | null,
  where: "expedition=resonance", group: "signal", sort: "title asc",
  layout: "constellation" as Layout,
  selected: null as string | null,
  readerMode: "rendered" as "rendered" | "source",
  editing: false,
  trail: [] as string[],
  from: "", to: "", route: [] as string[],
  step: -1, playing: false, paused: false, completed: false, tempo: 80,
  camera: { x: 0, y: 0, scale: 1 },
  notes: new Map<string, Note>(), records: new Map<string, BlockRecord>(),
  drafts: new Map<string, Draft>(), comments: new Map<string, CommentDraft>(),
  busy: new Set<string>(),
  invalidated: new Set<string>(),
};
let positions = new Map<string, { x: number; y: number }>();
let scheduler: ReturnType<typeof setTimeout> | undefined;
let atlasTicket = 0;
const noteTickets = new Map<string, number>();
let refreshPending = false;
let mapSignature = "";
let facetSignature = "";
let readerSignature = "";
let lastPollError = "";
let performanceGeneration = 0;
let persistenceKey = "";
let storageWarning = false;

function persistLocal() {
  if (!persistenceKey) return;
  try {
    localStorage.setItem(persistenceKey, JSON.stringify({
      trail: state.trail, selected: state.selected, layout: state.layout,
      from: state.from, to: state.to, tempo: state.tempo, readerMode: state.readerMode,
      title: input("score-title").value,
      drafts: Object.fromEntries(state.drafts), comments: Object.fromEntries(state.comments),
    }));
  } catch {
    if (!storageWarning) {
      storageWarning = true;
      notice("Browser storage is unavailable. Drafts and score stay in this tab only; save or copy them before closing.", "error");
    }
  }
}
function restoreLocal(atlas: Atlas) {
  const key = `resonance:${atlas.outline}:${atlas.root}`;
  if (persistenceKey === key) return;
  if (persistenceKey) {
    persistLocal(); pause(); sound.stop();
    state.selected = null; state.editing = false; state.readerMode = "rendered";
    state.trail = []; state.route = []; state.from = ""; state.to = "";
    state.step = -1; state.paused = false; state.completed = false; state.tempo = 80;
    state.notes.clear(); state.records.clear(); state.drafts.clear(); state.comments.clear();
    state.busy.clear(); state.invalidated.clear(); noteTickets.clear();
    state.camera = { x: 0, y: 0, scale: 1 }; state.layout = "constellation";
    mapSignature = ""; facetSignature = ""; readerSignature = "";
    input("score-title").value = "A path through the silence";
    textarea("note-source").value = ""; textarea("note-draft").value = "";
    textarea("comment-text").value = ""; textarea("comment-quote").value = "";
    message("edit-message", ""); message("comment-message", ""); message("score-message", "");
    $("reader-empty").replaceChildren(textNode("h3", "A new expedition is listening."), textNode("p", "Choose a signal. Previous drafts remain in their previous browser storage namespace, never in this outline."));
    renderRoute();
  }
  persistenceKey = key;
  storageWarning = false;
  try {
    const raw = localStorage.getItem(persistenceKey);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(saved.trail)) state.trail = saved.trail.filter((id): id is string => typeof id === "string");
    if (typeof saved.selected === "string") state.selected = saved.selected;
    if (saved.layout === "islands" || saved.layout === "chronology" || saved.layout === "constellation") state.layout = saved.layout;
    if (saved.readerMode === "source" || saved.readerMode === "rendered") state.readerMode = saved.readerMode;
    if (typeof saved.from === "string") state.from = saved.from;
    if (typeof saved.to === "string") state.to = saved.to;
    if (typeof saved.tempo === "number" && Number.isFinite(saved.tempo)) state.tempo = Math.max(40, Math.min(160, Math.round(saved.tempo)));
    if (typeof saved.title === "string") input("score-title").value = saved.title;
    if (saved.drafts && typeof saved.drafts === "object") for (const [id, value] of Object.entries(saved.drafts)) {
      const d = threadObject(value);
      if (typeof d.text === "string" && typeof d.base === "string" && typeof d.revision === "number") state.drafts.set(id, { text: d.text, base: d.base, revision: d.revision, stale: d.stale === true });
    }
    if (saved.comments && typeof saved.comments === "object") for (const [id, value] of Object.entries(saved.comments)) {
      const d = threadObject(value);
      if (typeof d.text === "string" && typeof d.quote === "string" && typeof d.revision === "number") state.comments.set(id, { text: d.text, quote: d.quote, revision: d.revision });
    }
  } catch {
    notice("Stored local state could not be read. The service notes remain intact; this tab starts with a fresh score.", "error");
  }
}

function notice(message: string, kind = "") {
  $("notice").textContent = message;
  $("notice").className = `notice ${kind}`;
}
function message(id: string, text: string, error = false) {
  $(id).textContent = text;
  $(id).classList.toggle("error", error);
}
function record(id: string): BlockRecord | undefined { return state.records.get(id); }
function title(id: string) { return record(id)?.title || `Note ${id.slice(0, 8)}`; }
function textNode(tag: string, text: string, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text: string, action: string, args: Args = {}, className = "") {
  const node = document.createElement("button");
  node.type = "button"; node.textContent = text; node.dataset.action = action;
  node.dataset.args = JSON.stringify(args);
  node.className = className;
  node.dataset.focusKey = `${action}:${JSON.stringify(args)}`;
  return node;
}
function preserveFocus(render: () => void) {
  const focused = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
  const key = focused?.dataset.focusKey;
  render();
  if (key && focused && !focused.isConnected) {
    const replacement = [...document.querySelectorAll<HTMLElement | SVGElement>("[data-focus-key]")].find(node => node.dataset.focusKey === key);
    replacement?.focus({ preventScroll: true });
  }
}
function setValueUnlessTyping(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  if (document.activeElement !== element && element.value !== value) element.value = value;
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? String(data.error) : `HTTP ${response.status}: the scratch service did not return a readable error.`;
    throw new Error(error);
  }
  return data as T;
}
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function selectedRecord() { return state.selected ? record(state.selected) : undefined; }
function requireSelected() {
  if (!state.selected || !selectedRecord()) throw new Error("Choose a note in the atlas or note index first.");
  return state.selected;
}
function selectedComment(): CommentDraft {
  const id = requireSelected();
  let draft = state.comments.get(id);
  if (!draft) {
    draft = { text: "", quote: "", revision: record(id)!.revision };
    state.comments.set(id, draft);
  }
  return draft;
}
function groupColor(id: string): string {
  const index = state.atlas?.groups.findIndex(group => group.ids.includes(id)) ?? -1;
  return index < 0 ? "#8c9d9f" : palette[index % palette.length]!;
}
function updateCamera() {
  const scene = document.getElementById("map-scene");
  const { x, y, scale } = state.camera;
  scene?.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  $("map-zoom").textContent = `${Math.round(scale * 100)}%`;
}
function svgNode(tag: string, attrs: Record<string, string>) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}
function renderMap(force = false) {
  const atlas = state.atlas;
  if (!atlas) return;
  const signature = JSON.stringify([state.layout, state.group, atlas.records.map(r => [r.id, r.title, r.properties]), atlas.edges, atlas.groups]);
  if (force || signature !== mapSignature) {
    mapSignature = signature;
    positions = arrange(atlas.records, atlas.edges, state.layout, atlas.groups);
    preserveFocus(() => {
      const groups = document.getElementById("map-groups")!;
      const edges = document.getElementById("map-edges")!;
      const nodes = document.getElementById("map-nodes")!;
      groups.replaceChildren(); edges.replaceChildren(); nodes.replaceChildren();
      if (state.layout === "islands") {
        for (const group of atlas.groups) {
          const points = group.ids.map(id => positions.get(id)).filter((p): p is { x: number; y: number } => !!p);
          if (!points.length) continue;
          const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
          const y = Math.min(...points.map(p => p.y)) - 43;
          const label = svgNode("text", { x: String(x), y: String(Math.max(25, y)), class: "map-group-label" });
          label.textContent = group.value ?? "No property"; groups.append(label);
          const count = svgNode("text", { x: String(x), y: String(Math.max(25, y) + 18), class: "map-group-count" });
          count.textContent = `${group.count} / ${state.group}`; groups.append(count);
        }
      } else if (state.layout === "chronology") {
        const label = svgNode("text", { x: "600", y: "35", class: "map-group-label" });
        label.textContent = "Authored time · when"; groups.append(label);
        const count = svgNode("text", { x: "600", y: "54", class: "map-group-count" });
        count.textContent = "Dates belong to the fiction. Undated notes remain visible."; groups.append(count);
        const undated = svgNode("text", { x: "600", y: "706", class: "map-group-count" });
        undated.textContent = "UNDATED / no valid authored when"; groups.append(undated);
      }
      for (const edge of atlas.edges) {
        const source = positions.get(edge.source), target = positions.get(edge.target);
        if (!source || !target) continue;
        const line = svgNode("line", { x1: String(source.x), y1: String(source.y), x2: String(target.x), y2: String(target.y), class: `map-edge ${edge.kind}`, ...(edge.kind === "link" ? { "marker-end": "url(#arrow)" } : {}) });
        line.dataset.source = edge.source; line.dataset.target = edge.target; line.dataset.kind = edge.kind;
        const description = svgNode("title", {}); description.textContent = `${title(edge.source)} → ${title(edge.target)} · ${edge.kind === "link" ? edge.label || "authored reference" : "hierarchy"}`;
        line.append(description); edges.append(line);
      }
      atlas.records.forEach((r, index) => {
        const point = positions.get(r.id); if (!point) return;
        const node = svgNode("g", { transform: `translate(${point.x} ${point.y})`, class: "map-node", tabindex: "0", role: "button", "aria-label": `Read ${r.title}`, "aria-pressed": "false" });
        node.dataset.id = r.id; node.dataset.action = "select"; node.dataset.args = JSON.stringify({ id: r.id });
        node.dataset.focusKey = `map:${r.id}`;
        node.style.setProperty("--node-color", groupColor(r.id));
        const label = svgNode("text", { y: "25", class: "node-label" });
        label.textContent = r.title.length > 32 ? `${r.title.slice(0, 29)}…` : r.title;
        const description = svgNode("title", {}); description.textContent = `${index + 1}. ${r.title}`;
        node.append(description, svgNode("circle", { r: "18", class: "halo" }), svgNode("circle", { r: "7", class: "dot" }), label);
        nodes.append(node);
      });
      const list = $("note-list"); list.replaceChildren();
      atlas.records.forEach((r, index) => {
        const row = button("", "select", { id: r.id }, "note-row"); row.dataset.id = r.id;
        const dot = textNode("i", "", "legend-dot"); dot.style.setProperty("--node-color", groupColor(r.id));
        row.append(textNode("span", String(index + 1).padStart(2, "0"), "ordinal"), dot, textNode("span", r.title || "Untitled note", "title"));
        row.title = r.title; list.append(row);
      });
      const legend = $("group-legend"); legend.replaceChildren();
      atlas.groups.forEach((group, index) => {
        const item = textNode("span", "", "legend-item");
        const dot = textNode("i", "", "legend-dot"); dot.style.setProperty("--node-color", palette[index % palette.length]!);
        item.append(dot, textNode("span", group.value ?? "No property"), textNode("span", String(group.count), "count")); legend.append(item);
      });
    });
  }
  const neighbors = new Set<string>();
  for (const edge of atlas.edges) {
    if (edge.kind !== "link") continue;
    if (edge.source === state.selected) neighbors.add(edge.target);
    if (edge.target === state.selected) neighbors.add(edge.source);
  }
  document.getElementById("map-scene")!.dataset.selected = String(!!state.selected);
  const routePairs = new Set(state.route.slice(1).flatMap((id, i) => [`${state.route[i]}:${id}`, `${id}:${state.route[i]}`]));
  document.querySelectorAll<SVGElement>(".map-edge").forEach(edge => {
    edge.classList.toggle("selected", edge.dataset.source === state.selected || edge.dataset.target === state.selected);
    edge.classList.toggle("route", edge.dataset.kind === "link" && routePairs.has(`${edge.dataset.source}:${edge.dataset.target}`));
  });
  document.querySelectorAll<SVGElement>(".map-node").forEach(node => {
    const id = node.dataset.id!;
    node.classList.toggle("selected", id === state.selected); node.classList.toggle("in-trail", state.trail.includes(id)); node.classList.toggle("route", state.route.includes(id));
    node.classList.toggle("neighbor", neighbors.has(id));
    node.setAttribute("aria-pressed", String(id === state.selected));
  });
  document.querySelectorAll<HTMLElement>(".note-row").forEach(row => row.setAttribute("aria-current", String(row.dataset.id === state.selected)));
  $("map-empty").hidden = atlas.records.length > 0;
  $("map-empty").textContent = "No signals in this query. Reset the expedition or change a property clause.";
  $("atlas-count").textContent = `${atlas.records.length} / ${atlas.total} notes`;
  $("index-count").textContent = `(${atlas.records.length})`;
  const completeness = typeof atlas.completeness === "string" ? atlas.completeness : JSON.stringify(atlas.completeness);
  $("completeness").textContent = `Service completeness: ${completeness ?? "not reported"}. Visible limit: 240. Reference routes are limited to returned notes.${atlas.total > atlas.records.length ? " Some notes are not shown; narrow the query to explore them." : ""}`;
  document.querySelectorAll<HTMLButtonElement>('[data-action="layout.set"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.layout)));
  updateCamera();
}
function updateOptions(control: HTMLSelectElement, records: BlockRecord[], current: string, placeholder: string) {
  const signature = JSON.stringify(records.map(r => [r.id, r.title]));
  if (control.dataset.signature !== signature) {
    control.dataset.signature = signature;
    control.replaceChildren(new Option(placeholder, ""), ...records.map(r => new Option(r.title || "Untitled", r.id)));
  }
  for (const option of [...control.options]) if (option.dataset.outside === "true") option.remove();
  if (current && !records.some(r => r.id === current)) {
    const option = new Option(`${title(current)} (outside this query)`, current);
    option.dataset.outside = "true"; control.add(option);
  }
  control.value = current;
}
function renderFacets() {
  const atlas = state.atlas; if (!atlas) return;
  const signature = JSON.stringify([atlas.facets, state.group]);
  if (facetSignature !== signature) {
    facetSignature = signature;
    preserveFocus(() => {
      const keys = atlas.facets.map(f => f.key);
      if (!keys.includes(state.group)) keys.unshift(state.group);
      select("group").replaceChildren(...keys.map(key => new Option(key, key)));
      select("group").value = state.group;
      const facets = $("facets"); facets.replaceChildren();
      for (const facet of atlas.facets) {
        const box = textNode("div", "", "facet"); box.append(textNode("h3", facet.key));
        const values = textNode("div", "", "facet-values");
        for (const value of facet.values) {
          const choice = button(value.value, "query.facet", { key: facet.key, value: value.value });
          choice.append(textNode("span", String(value.count))); values.append(choice);
        }
        if (facet.more) values.append(textNode("span", `+${facet.more} further values; query this property directly.`, "facet-more"));
        box.append(values); facets.append(box);
      }
      if (!atlas.facets.length) facets.append(textNode("p", "No properties in this result. Reset the expedition query to see available keys.", "muted-text"));
    });
  }
  updateOptions(select("route-from"), atlas.records, state.from, "Choose starting note");
  updateOptions(select("route-to"), atlas.records, state.to, "Choose destination");
}
const escapeHTML = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function frameDocument(html: string) {
  // Keep the service renderer's structure, but make its document an inert reading surface.
  // Live reference navigation belongs to the shared select action below the frame.
  const fragment = document.createElement("template");
  fragment.innerHTML = html;
  fragment.content.querySelectorAll("script,iframe,object,embed,base,meta,link,form").forEach(node => node.remove());
  fragment.content.querySelectorAll("*").forEach(node => {
    node.removeAttribute("href"); node.removeAttribute("xlink:href");
    node.removeAttribute("target"); node.removeAttribute("srcset");
    if (node.hasAttribute("src") && !(node.tagName === "IMG" && node.getAttribute("src")?.startsWith("data:"))) node.removeAttribute("src");
    for (const attribute of [...node.attributes]) if (attribute.name.toLowerCase().startsWith("on")) node.removeAttribute(attribute.name);
  });
  html = fragment.innerHTML;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'"><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:14px 25px 30px;background:#101c22;color:#dedecd;font:16px/1.85 Georgia,serif;overflow-wrap:anywhere}h1,h2,h3{line-height:1.3;font-weight:normal;color:#eee8d8}h1{font-size:30px}h2{font-size:25px}h3{font-size:21px}a{color:#8bcec7;text-decoration-color:#537e79;pointer-events:none}blockquote{border-left:2px solid #e79b86;padding-left:15px;margin-left:0;color:#b8c5bb}pre,code{font:12px/1.6 Consolas,monospace;background:#0c171d;white-space:pre-wrap}pre{padding:12px;overflow:auto}img{max-width:100%}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #33484b;padding:6px}hr{border:0;border-top:1px solid #35474b}mark.ann{background:#d0bd8c;color:#101c22;border-radius:2px;padding:0 2px}button,input,textarea,select,iframe,video,audio{display:none}.property-chip,.chip{font:10px/1.5 Consolas,monospace;color:#9cbfb7}::selection{background:#46645e;color:#fff}</style></head><body>${html}</body></html>`;
}
function renderReferences(r: BlockRecord) {
  const refs = $("note-references"), back = $("note-backlinks"); refs.replaceChildren(); back.replaceChildren();
  const outgoing = textNode("div", "", "reference-list");
  for (const link of r.links) {
    if (link.target) outgoing.append(button(link.label || title(link.target), "select", { id: link.target }));
    else outgoing.append(textNode("span", `${link.label || link.text} · ${link.status || "unresolved"}`, "unresolved-reference"));
  }
  if (!r.links.length) outgoing.append(textNode("p", "No authored references.", "muted-text"));
  refs.append(outgoing);
  const incoming = textNode("div", "", "reference-list");
  for (const id of r.backlinks) incoming.append(button(title(id), "select", { id }));
  if (!r.backlinks.length) incoming.append(textNode("p", "No notes reference this one yet.", "muted-text"));
  back.append(incoming);
}
function threadObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : { body: String(value ?? "") };
}
function renderThreads(threads: unknown[]) {
  const target = $("comment-threads"); target.replaceChildren();
  $("comment-count").textContent = `${threads.length} thread${threads.length === 1 ? "" : "s"}`;
  if (!threads.length) target.append(textNode("p", "No listening notes yet. Leave a whole-note comment, or select exact text in Blockdown source.", "muted-text"));
  for (const value of threads) {
    const thread = threadObject(value);
    const article = textNode("article", "", "comment-thread");
    if (thread.quote) article.append(textNode("blockquote", String(thread.quote)));
    article.append(textNode("p", String(thread.body ?? ""), "comment-body"));
    article.append(textNode("p", `${String(thread.by ?? "user")} · ${String(thread.at ?? "")}${thread.quote ? " · source quote" : " · whole note"}`, "comment-meta"));
    if (Array.isArray(thread.replies)) for (const value of thread.replies) {
      const reply = threadObject(value), node = textNode("div", "", "comment-reply");
      node.append(textNode("p", String(reply.body ?? ""), "comment-body"), textNode("p", `${String(reply.by ?? "user")} · ${String(reply.at ?? "")}`, "comment-meta")); article.append(node);
    }
    target.append(article);
  }
}
function renderReader() {
  const id = state.selected, r = selectedRecord(), note = id ? state.notes.get(id) : undefined;
  $("reader-empty").hidden = !!r; $("reader-content").hidden = !r;
  if (!r || !id) return;
  $("note-title").textContent = r.title || "Untitled note";
  $("reader-revision").textContent = `revision ${r.revision}`;
  $("reader-kicker").textContent = `${state.group} / ${r.properties.find(p => p.key === state.group)?.values.join(" · ") || "ungrouped"}`;
  const signature = JSON.stringify([id, r.revision, note?.html, note?.threads]);
  if (signature !== readerSignature) {
    readerSignature = signature;
    preserveFocus(() => {
      const properties = $("note-properties"); properties.replaceChildren();
      for (const property of r.properties) {
        const chip = textNode("span", "", "property-chip"); chip.append(textNode("span", property.key), document.createTextNode(property.values.join(" · "))); properties.append(chip);
      }
      renderReferences(r); renderThreads(note?.threads ?? []);
    });
  }
  setValueUnlessTyping(textarea("note-source"), r.text);
  const frame = $<HTMLIFrameElement>("rendered-note");
  const html = note?.html ?? (frame.dataset.noteId === id ? undefined : `<p>${escapeHTML("Loading the service-rendered note…")}</p>`);
  if (html !== undefined && (frame.dataset.noteId !== id || frame.dataset.html !== html) && document.activeElement !== frame) {
    frame.srcdoc = frameDocument(html); frame.dataset.noteId = id; frame.dataset.html = html;
  }
  $("rendered-note").hidden = state.readerMode !== "rendered";
  $("source-wrap").hidden = state.readerMode !== "source";
  document.querySelectorAll<HTMLButtonElement>('[data-action="reader.mode"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.readerMode)));
  $("editor").hidden = !state.editing;
  const draft = state.drafts.get(id);
  if (draft) {
    setValueUnlessTyping(textarea("note-draft"), draft.text);
    $("draft-state").textContent = `${draft.text === draft.base ? "Unchanged" : "Unsaved"} · based on revision ${draft.revision}${draft.stale ? " · newer source available" : ""}`;
  }
  $("rebase-button").hidden = !draft?.stale;
  const comment = state.comments.get(id);
  setValueUnlessTyping(textarea("comment-text"), comment?.text ?? "");
  setValueUnlessTyping(textarea("comment-quote"), comment?.quote ?? "");
  document.querySelectorAll<HTMLButtonElement>('[data-action="edit.save"]').forEach(b => b.disabled = state.busy.has(`edit:${id}`));
  const commentButton = $("comment-form").querySelector<HTMLButtonElement>('button[type="submit"]');
  if (commentButton) commentButton.disabled = state.busy.has(`comment:${id}`);
}
function renderTrail() {
  preserveFocus(() => {
    const trail = $("trail"); trail.replaceChildren();
    if (!state.trail.length) trail.append(textNode("li", "No score yet. Read a note and add it, or weave a path between two signals.", "trail-empty"));
    state.trail.forEach((id, index) => {
      const item = textNode("li", "", `trail-step${index === state.step ? " current" : ""}`);
      const choice = button("", "performance.step", { index }, "trail-select");
      choice.append(textNode("span", String(index + 1).padStart(2, "0")), textNode("strong", title(id)));
      choice.setAttribute("aria-label", `Read score step ${index + 1}: ${title(id)}`);
      choice.setAttribute("aria-current", String(index === state.step));
      const controls = textNode("div", "", "trail-controls");
      const earlier = button("←", "trail.move", { index, direction: -1 }); earlier.disabled = index === 0; earlier.setAttribute("aria-label", `Move step ${index + 1} earlier`);
      const later = button("→", "trail.move", { index, direction: 1 }); later.disabled = index === state.trail.length - 1; later.setAttribute("aria-label", `Move step ${index + 1} later`);
      const remove = button("×", "trail.remove", { index }); remove.setAttribute("aria-label", `Remove step ${index + 1}`);
      controls.append(earlier, later, remove); item.append(choice, controls); trail.append(item);
    });
  });
  renderPerformance();
}
function renderPerformance() {
  $("play-button").textContent = state.playing ? "Pause ␣" : "Play ␣";
  $("play-button").setAttribute("aria-pressed", String(state.playing));
  $("sound-button").textContent = sound.enabled ? "Sound on" : "Sound off";
  $("sound-button").setAttribute("aria-pressed", String(sound.enabled));
  $("tempo-value").textContent = String(state.tempo);
  input("tempo").value = String(state.tempo);
  const status = state.playing ? "Performing" : state.paused ? "Paused" : state.completed ? "Complete" : "Ready";
  $("performance-status").textContent = !state.trail.length ? "No score yet" : `${status} · ${state.step < 0 ? "ready" : `${state.step + 1} / ${state.trail.length} · ${title(state.trail[state.step]!)}`} · 2 beats / step`;
}
function renderRoute() {
  preserveFocus(() => {
    const target = $("route-preview"); target.replaceChildren();
    if (!state.route.length) target.textContent = "Choose two endpoints. Hierarchy never supplies a shortcut.";
    else state.route.forEach((id, index) => {
      if (index) {
        const previous = state.route[index - 1]!;
        const forward = state.atlas?.edges.some(e => e.kind === "link" && e.source === previous && e.target === id);
        const reverse = state.atlas?.edges.some(e => e.kind === "link" && e.source === id && e.target === previous);
        const arrow = textNode("span", forward && reverse ? "↔" : forward ? "→" : "←", "route-direction");
        arrow.title = forward && reverse ? "Both notes author a reference" : forward ? "Previous note references next" : "Next note references previous; route traverses in reverse";
        target.append(arrow);
      }
      target.append(button(title(id), "select", { id }));
    });
  });
  $<HTMLButtonElement>("append-route").disabled = state.route.length === 0;
}
async function loadNote(id: string, force = false) {
  const ticket = (noteTickets.get(id) ?? 0) + 1, session = persistenceKey;
  noteTickets.set(id, ticket);
  if (!force && state.notes.has(id) && !state.invalidated.has(id)) { renderReader(); return; }
  if (id === state.selected) message("reader-message", "Loading rendered note and listening notes…");
  try {
    const note = await api<Note>(`/api/note/${encodeURIComponent(id)}`);
    if (ticket !== noteTickets.get(id) || session !== persistenceKey || note.record.revision < (record(id)?.revision ?? 0)) return;
    state.records.set(id, note.record); state.notes.set(id, note); state.invalidated.delete(id);
    const draft = state.drafts.get(id);
    if (draft && draft.revision !== note.record.revision) draft.stale = true;
    if (id === state.selected) {
      renderReader();
      message("reader-message", draft?.stale ? "The service has a newer revision. Your draft is intact; inspect the latest Blockdown source before rebasing." : "Rendered by the outline service. Follow live references below; source quotes are available in Blockdown mode.");
    }
  } catch (error) {
    if (id === state.selected && ticket === noteTickets.get(id) && session === persistenceKey) {
      renderReader(); message("reader-message", `${errorText(error)} Choose another note or use Refresh to request this one again. Any local draft is intact.`, true);
      if (!selectedRecord()) {
        $("reader-empty").hidden = false;
        $("reader-empty").replaceChildren(textNode("h3", "This signal is unavailable."), textNode("p", `${errorText(error)} Choose a note in the index; local drafts have not been discarded.`));
      }
    }
  }
}
async function selectNote(id: string) {
  if (!id) throw new Error("A note id is required.");
  if (state.playing && id !== state.trail[state.step]) pause();
  const previous = state.selected;
  state.selected = id;
  if (previous !== id) {
    state.editing = false;
    readerSignature = "";
    textarea("note-source").value = record(id)?.text ?? "";
    textarea("note-draft").value = state.drafts.get(id)?.text ?? "";
    textarea("comment-text").value = state.comments.get(id)?.text ?? "";
    textarea("comment-quote").value = state.comments.get(id)?.quote ?? "";
    message("edit-message", ""); message("comment-message", "");
    $("reader-empty").hidden = false;
    const reader = $("reader-content").closest<HTMLElement>(".reader-panel");
    if (reader) reader.scrollTop = 0;
  }
  renderMap(); renderReader();
  await loadNote(id);
}
async function loadAtlas(manual = false) {
  if (refreshPending && !manual) return;
  refreshPending = true;
  const ticket = ++atlasTicket;
  const params = new URLSearchParams({ where: state.where, group: state.group, sort: state.sort });
  if (manual || !state.atlas) notice("Asking the service for notes, references, groups and property facets…");
  try {
    const atlas = await api<Atlas & { hint?: unknown }>(`/api/atlas?${params}`);
    if (ticket !== atlasTicket) return;
    const previous = state.atlas;
    const restarted = !!previous && previous.root !== atlas.root;
    const changed = !previous || restarted || previous.sequence !== atlas.sequence;
    state.atlas = atlas;
    restoreLocal(atlas);
    for (const r of atlas.records) {
      state.records.set(r.id, r);
      const cached = state.notes.get(r.id);
      if (cached && cached.record.revision !== r.revision) state.invalidated.add(r.id);
      const draft = state.drafts.get(r.id);
      if (draft && draft.revision !== r.revision) draft.stale = true;
    }
    if (changed && previous) for (const id of state.notes.keys()) state.invalidated.add(id);
    if (state.route.length) {
      state.route = shortestRoute(atlas.records, atlas.edges, state.from, state.to);
      renderRoute();
    }
    renderMap(); renderFacets(); renderReader(); renderTrail();
    $("connection").textContent = `${atlas.outline} · scratch · sequence ${atlas.sequence}`;
    if (manual || changed || lastPollError) {
      const hint = atlas.hint ? ` ${typeof atlas.hint === "string" ? atlas.hint : JSON.stringify(atlas.hint)}` : "";
      notice(`${atlas.records.length} notes returned by the service.${hint}${restarted ? " New scratch expedition detected; previous drafts and scores stay in their previous browser storage namespace." : changed && previous ? " Live changes received; your selection, drafts and score are preserved." : ""}`, "success");
    }
    lastPollError = "";
    if (state.selected && (changed || manual || !state.notes.has(state.selected) || state.invalidated.has(state.selected))) await loadNote(state.selected, true);
  } catch (error) {
    if (ticket !== atlasTicket) return;
    lastPollError = errorText(error);
    notice(`${lastPollError} Change the service query or press Refresh. Previous results and all drafts remain available.`, "error");
    $("connection").textContent = "Service unavailable · local drafts retained";
    if (!state.atlas) { $("map-empty").hidden = false; $("map-empty").textContent = "The station did not answer. Check the scratch demo terminal, then Refresh."; }
  } finally { if (ticket === atlasTicket) refreshPending = false; }
}
function pause() {
  performanceGeneration++;
  state.paused = state.playing || state.paused;
  state.playing = false; clearTimeout(scheduler); scheduler = undefined; renderPerformance();
}
async function performStep(index: number): Promise<boolean> {
  if (!state.trail.length) throw new Error("Add notes or a reference path to the score before performing it.");
  state.paused = false; state.completed = false;
  const generation = performanceGeneration;
  state.step = Math.max(0, Math.min(state.trail.length - 1, index));
  const id = state.trail[state.step]!;
  await selectNote(id);
  if (generation !== performanceGeneration || state.selected !== id || state.editing) return false;
  const r = record(id);
  if (!r) { pause(); throw new Error("The score's note is unavailable. Remove this step or refresh the scratch service."); }
  if (sound.enabled) sound.strike(r, state.step);
  renderTrail(); renderMap();
  return true;
}
function schedule() {
  clearTimeout(scheduler);
  if (!state.playing) return;
  scheduler = setTimeout(() => { void dispatch("performance.tick"); }, 120_000 / state.tempo);
}
function clearRoute() { state.route = []; renderRoute(); renderMap(); }
function indexArg(args: Args) {
  const index = Number(args.index);
  if (!Number.isInteger(index) || index < 0 || index >= state.trail.length) throw new Error("That score step no longer exists.");
  return index;
}

/** The sole action path: pointer controls, keyboard controls and browser automation use this dispatcher. */
async function dispatch(action: string, args: Args = {}): Promise<unknown> {
  try {
    switch (action) {
      case "select": return await selectNote(String(args.id ?? ""));
      case "help.toggle": case "lens.toggle": {
        const id = action === "help.toggle" ? "help" : "lens"; $(id).hidden = !$(id).hidden;
        document.querySelectorAll<HTMLElement>(`[data-action="${action}"]`).forEach(node => node.setAttribute("aria-expanded", String(!$(id).hidden))); return;
      }
      case "query.apply": {
        state.where = String(args.where ?? input("query").value).trim();
        state.sort = String(args.sort ?? input("sort").value).trim() || "title asc";
        state.group = String(args.group ?? select("group").value).trim();
        if (!state.group) throw new Error("Choose an authored property to group by.");
        setValueUnlessTyping(input("query"), state.where); setValueUnlessTyping(input("sort"), state.sort);
        clearRoute(); await loadAtlas(true); return;
      }
      case "query.reset": {
        input("query").value = "expedition=resonance"; state.where = "expedition=resonance";
        clearRoute(); await loadAtlas(true); return;
      }
      case "query.facet": {
        const value = String(args.value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
        const clause = `${String(args.key)}="${value}"`;
        state.where = state.where ? `(${state.where}) AND ${clause}` : clause;
        input("query").value = state.where; clearRoute(); await loadAtlas(true); return;
      }
      case "atlas.refresh": await loadAtlas(true); return;
      case "layout.set": {
        const mode = String(args.mode);
        if (mode !== "constellation" && mode !== "islands" && mode !== "chronology") throw new Error("Choose constellation, islands or chronology.");
        state.layout = mode; renderMap(); return;
      }
      case "map.reset": state.camera = { x: 0, y: 0, scale: 1 }; updateCamera(); return;
      case "map.pan": {
        state.camera.x += Number(args.x) || 0; state.camera.y += Number(args.y) || 0; updateCamera(); return;
      }
      case "map.zoom": {
        const factor = Number(args.factor); if (!(factor > 0 && Number.isFinite(factor))) throw new Error("Zoom needs a positive finite factor.");
        const x = Number(args.x ?? 600), y = Number(args.y ?? 400);
        const old = state.camera.scale, next = Math.min(3.5, Math.max(.45, old * factor));
        state.camera.x = x - (x - state.camera.x) * next / old;
        state.camera.y = y - (y - state.camera.y) * next / old;
        state.camera.scale = next; updateCamera(); return;
      }
      case "reader.mode": {
        if (args.mode !== "source" && args.mode !== "rendered") throw new Error("Reader mode must be source or rendered.");
        state.readerMode = args.mode; renderReader(); return;
      }
      case "edit.open": {
        const id = requireSelected(); pause();
        const r = record(id)!;
        if (!state.drafts.has(id)) state.drafts.set(id, { text: r.text, base: r.text, revision: r.revision, stale: false });
        state.editing = true; renderReader(); textarea("note-draft").focus(); return;
      }
      case "edit.change": {
        const id = requireSelected(), draft = state.drafts.get(id);
        if (!draft) throw new Error("Open the note editor before changing a draft.");
        draft.text = String(args.text ?? textarea("note-draft").value);
        if (textarea("note-draft").value !== draft.text) textarea("note-draft").value = draft.text;
        renderReader(); return;
      }
      case "edit.close": state.editing = false; renderReader(); notice("Draft put aside locally. Return to this note and choose Edit to resume it."); return;
      case "edit.discard": {
        const id = requireSelected(); state.drafts.delete(id); state.editing = false; renderReader(); message("edit-message", "Draft discarded; canonical note unchanged."); return;
      }
      case "edit.rebase": {
        const id = requireSelected(), draft = state.drafts.get(id), r = record(id)!;
        if (!draft) throw new Error("No draft to rebase.");
        draft.revision = r.revision; draft.base = r.text; draft.stale = false; renderReader();
        message("edit-message", `Your text is intact and now based on revision ${r.revision}. Saving will replace that source with your draft; inspect both before saving.`); return;
      }
      case "edit.save": {
        const id = requireSelected(), draft = state.drafts.get(id), key = `edit:${id}`;
        if (!draft) throw new Error("Open the editor and write a draft first.");
        if (state.busy.has(key)) return;
        const submitted = { text: draft.text, revision: draft.revision }, session = persistenceKey; state.busy.add(key); renderReader();
        try {
          const result = await api<{ record: BlockRecord }>(`/api/note/${encodeURIComponent(id)}`, submitted);
          if (session !== persistenceKey) return;
          state.records.set(id, result.record); state.notes.delete(id);
          if (draft.text === submitted.text) { state.drafts.delete(id); if (state.selected === id) state.editing = false; }
          else { draft.revision = result.record.revision; draft.base = result.record.text; draft.stale = false; }
          if (state.selected === id) message("edit-message", "Revision saved to the scratch outline.");
          notice("Note saved with an optimistic revision check. The score still embeds the live note.", "success");
          await loadAtlas(true);
        } catch (error) {
          if (session !== persistenceKey) return;
          if (state.selected === id) message("edit-message", `${errorText(error)} Your complete draft is preserved. Refresh the latest source before deciding whether to rebase; do not blindly retry.`, true);
          await loadNote(id, true);
        } finally { state.busy.delete(key); renderReader(); }
        return;
      }
      case "comment.change": {
        const draft = selectedComment();
        if (args.text !== undefined) draft.text = String(args.text);
        if (args.quote !== undefined) draft.quote = String(args.quote);
        if (textarea("comment-text").value !== draft.text) textarea("comment-text").value = draft.text;
        if (textarea("comment-quote").value !== draft.quote) textarea("comment-quote").value = draft.quote;
        return;
      }
      case "comment.quoteSelection": {
        const id = requireSelected(), source = textarea("note-source");
        const quote = source.value.slice(source.selectionStart, source.selectionEnd);
        if (!quote) throw new Error("In Blockdown mode, select exact stored source text first. Or leave the anchor empty for a whole-note comment.");
        if (!record(id)!.text.includes(quote)) throw new Error("That displayed source is older than the current note. Refresh source and select the quote again; your comment is preserved.");
        const draft = selectedComment(); draft.quote = quote; draft.revision = record(id)!.revision;
        textarea("comment-quote").value = quote; message("comment-message", "Exact source quote captured. The service will check its revision and uniqueness."); textarea("comment-text").focus(); return;
      }
      case "comment.whole": {
        const draft = selectedComment(); draft.quote = ""; draft.revision = selectedRecord()!.revision;
        textarea("comment-quote").value = "";
        message("comment-message", `Whole-note anchor at revision ${draft.revision}. Your comment text is unchanged.`); return;
      }
      case "comment.save": {
        const id = requireSelected(), draft = selectedComment(), key = `comment:${id}`;
        if (!draft.text.trim()) throw new Error("Write a comment before posting it.");
        if (state.busy.has(key)) return;
        const submitted = { ...draft }, session = persistenceKey; state.busy.add(key); renderReader();
        try {
          await api("/api/comment", { id, revision: submitted.revision, text: submitted.text, ...(submitted.quote ? { quote: submitted.quote } : {}) });
          if (session !== persistenceKey) return;
          if (draft.text === submitted.text && draft.quote === submitted.quote) state.comments.delete(id);
          if (state.selected === id) {
            if (!state.comments.has(id)) { textarea("comment-text").value = ""; textarea("comment-quote").value = ""; }
            message("comment-message", "Comment posted to the scratch outline.");
          }
          await loadNote(id, true); await loadAtlas(true);
        } catch (error) {
          if (session !== persistenceKey) return;
          if (state.selected === id) message("comment-message", `${errorText(error)} Comment and quote preserved. Review the current source, then explicitly recapture the quote or choose a whole-note anchor before posting again.`, true);
          await loadNote(id, true);
        } finally { state.busy.delete(key); renderReader(); }
        return;
      }
      case "trail.add": {
        const id = String(args.id ?? requireSelected()); if (!record(id)) await loadNote(id);
        if (!record(id)) throw new Error("This note is unavailable and cannot be added.");
        state.trail.push(id); renderTrail(); renderMap(); message("score-message", `Added ${title(id)}. Repeated notes are allowed.`); return;
      }
      case "trail.remove": {
        pause(); state.paused = false; state.completed = false; const index = indexArg(args); state.trail.splice(index, 1);
        if (index < state.step) state.step--; else if (index === state.step) state.step = -1;
        renderTrail(); renderMap(); return;
      }
      case "trail.move": {
        pause(); state.paused = false; state.completed = false; const index = indexArg(args), target = index + Number(args.direction);
        if (!Number.isInteger(target) || target < 0 || target >= state.trail.length) return;
        const item = state.trail.splice(index, 1)[0]!; state.trail.splice(target, 0, item);
        if (state.step === index) state.step = target;
        else if (index < state.step && target >= state.step) state.step--;
        else if (index > state.step && target <= state.step) state.step++;
        renderTrail(); renderMap(); return;
      }
      case "trail.clear": pause(); state.paused = false; state.completed = false; state.trail = []; state.step = -1; renderTrail(); renderMap(); message("score-message", "Local score cleared. Saved notes are not changed."); return;
      case "trail.save": {
        if (!state.trail.length) throw new Error("Add at least one note before saving a score.");
        const scoreTitle = String(args.title ?? input("score-title").value).trim();
        if (!scoreTitle) throw new Error("Give your live-embed score a title.");
        if (state.busy.has("score")) return;
        state.busy.add("score");
        const session = persistenceKey;
        const submit = $("save-score").querySelector<HTMLButtonElement>('button[type="submit"]')!; submit.disabled = true;
        try {
          const result = await api<{ id: string; title: string }>("/api/trail", { title: scoreTitle, ids: [...state.trail] });
          if (session !== persistenceKey) return;
          $("score-message").replaceChildren(document.createTextNode("Live-embed score saved. "), button(`Open ${result.title}`, "select", { id: result.id }));
          $("score-message").classList.remove("error"); await loadAtlas(true); return result;
        } catch (error) { if (session === persistenceKey) message("score-message", `${errorText(error)} Your score and title are preserved; no automatic write retry was made.`, true); }
        finally { state.busy.delete("score"); submit.disabled = false; }
        return;
      }
      case "route.endpoint": {
        const endpoint = String(args.endpoint); if (endpoint !== "from" && endpoint !== "to") throw new Error("Choose a From or To endpoint.");
        const id = String(args.id ?? requireSelected()); state[endpoint] = id; clearRoute(); renderFacets(); return;
      }
      case "route.find": {
        if (!state.from || !state.to) throw new Error("Choose both From and To endpoints, or use the selected note for each.");
        const atlas = state.atlas; if (!atlas) throw new Error("Wait for the service atlas before finding a route.");
        state.route = shortestRoute(atlas.records, atlas.edges, state.from, state.to); renderRoute(); renderMap();
        if (!state.route.length) $("route-preview").textContent = "No reference path in the returned notes. Broaden the service query or choose another endpoint; hierarchy is deliberately excluded.";
        else notice(`Found ${state.route.length} notes along actual references. Arrow marks retain authored direction; navigation is bidirectional.`, "success");
        return [...state.route];
      }
      case "trail.title": {
        if (args.title !== undefined) input("score-title").value = String(args.title);
        return;
      }
      case "route.append": {
        if (!state.route.length) throw new Error("Find a reference path first.");
        state.trail.push(...state.route); renderTrail(); renderMap(); message("score-message", `Added ${state.route.length} path notes in route order.`); return;
      }
      case "performance.toggle": {
        if (state.playing) { pause(); return; }
        if (state.editing) throw new Error("Put your editor draft aside before performing; your draft stays local.");
        if (!state.trail.length) throw new Error("Add a note or weave a reference path before playing.");
        if (state.paused && state.step >= 0 && state.step < state.trail.length && state.selected === state.trail[state.step]) {
          state.paused = false; state.playing = true; renderPerformance(); schedule(); return;
        }
        const next = state.step < 0 || state.step >= state.trail.length - 1 ? 0 : state.step;
        if (await performStep(next)) { state.playing = true; renderPerformance(); schedule(); } return;
      }
      case "performance.tick": {
        if (!state.playing) return;
        if (state.step >= state.trail.length - 1) { pause(); state.paused = false; state.completed = true; renderPerformance(); return; }
        if (await performStep(state.step + 1)) schedule(); return;
      }
      case "performance.step": pause(); await performStep(indexArg(args)); return;
      case "performance.previous": pause(); await performStep(state.step <= 0 ? 0 : state.step - 1); return;
      case "performance.next": pause(); await performStep(state.step + 1); return;
      case "performance.stop": pause(); state.paused = false; state.completed = false; sound.stop(); state.step = -1; renderTrail(); return;
      case "performance.tempo": {
        const tempo = Number(args.value); if (!Number.isFinite(tempo)) throw new Error("Tempo must be a number from 40 to 160 BPM.");
        state.tempo = Math.min(160, Math.max(40, Math.round(tempo))); renderPerformance(); if (state.playing) schedule(); return;
      }
      case "sound.toggle": {
        if (sound.enabled) sound.stop(); else await sound.enable(); renderPerformance();
        notice(sound.enabled ? "Sound enabled by you. Tones derive from structural properties, not semantic interpretation." : "Sound off. The score can still perform silently."); return;
      }
      default: throw new Error(`Unknown Resonance action: ${action}`);
    }
  } catch (error) {
    const text = errorText(error);
    notice(text, "error");
    if (action.startsWith("comment.")) message("comment-message", text, true);
    if (action.startsWith("edit.")) message("edit-message", text, true);
    if (action.startsWith("route.")) $("route-preview").textContent = text;
    if (action.startsWith("trail.") || action.startsWith("performance.")) message("score-message", text, true);
    return { error: text };
  } finally {
    if (action !== "map.pan" && action !== "map.zoom" && action !== "performance.tick") persistLocal();
  }
}

function argsFrom(element: HTMLElement | SVGElement): Args {
  if (element.dataset.args) return JSON.parse(element.dataset.args) as Args;
  const args: Args = {};
  for (const [key, value] of Object.entries(element.dataset)) if (key !== "action" && key !== "focusKey") args[key] = value;
  return args;
}
document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement | SVGElement>("[data-action]") : null;
  if (target && !(target instanceof HTMLButtonElement && target.disabled)) void dispatch(target.dataset.action!, argsFrom(target));
});
$("query-form").addEventListener("submit", event => { event.preventDefault(); void dispatch("query.apply"); });
$("comment-form").addEventListener("submit", event => { event.preventDefault(); void dispatch("comment.save"); });
$("save-score").addEventListener("submit", event => { event.preventDefault(); void dispatch("trail.save"); });
select("group").addEventListener("change", () => { void dispatch("query.apply", { group: select("group").value, where: state.where, sort: state.sort }); });
input("sort").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void dispatch("query.apply"); } });
select("route-from").addEventListener("change", () => { void dispatch("route.endpoint", { endpoint: "from", id: select("route-from").value }); });
select("route-to").addEventListener("change", () => { void dispatch("route.endpoint", { endpoint: "to", id: select("route-to").value }); });
input("tempo").addEventListener("input", () => { void dispatch("performance.tempo", { value: Number(input("tempo").value) }); });
textarea("note-draft").addEventListener("input", () => { void dispatch("edit.change", { text: textarea("note-draft").value }); });
textarea("comment-text").addEventListener("input", () => { void dispatch("comment.change", { text: textarea("comment-text").value }); });
textarea("comment-quote").addEventListener("input", () => { void dispatch("comment.change", { quote: textarea("comment-quote").value }); });
input("score-title").addEventListener("input", () => { void dispatch("trail.title", { title: input("score-title").value }); });
document.addEventListener("focusin", event => {
  if (event.target === textarea("note-source")) return;
  if (state.selected) renderReader();
});

document.addEventListener("keydown", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input,textarea,select,[contenteditable=true]")) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const actionTarget = target?.closest<HTMLElement | SVGElement>(".map-node");
  if (actionTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); void dispatch("select", { id: actionTarget.dataset.id }); return; }
  if (event.key === " " && target?.closest("button,summary,a")) return;
  const actions: Record<string, string> = { " ": "performance.toggle", ArrowLeft: "performance.previous", ArrowRight: "performance.next", a: "trail.add", A: "trail.add", e: "edit.open", E: "edit.open", Escape: "performance.stop", "?": "help.toggle", "+": "map.zoom", "=": "map.zoom", "-": "map.zoom" };
  const action = actions[event.key];
  if (action) { event.preventDefault(); void dispatch(action, action === "map.zoom" ? { factor: event.key === "-" ? 1 / 1.2 : 1.2 } : {}); }
});
const map = document.getElementById("atlas-map") as unknown as SVGSVGElement;
function mapPoint(clientX: number, clientY: number) {
  const point = map.createSVGPoint(); point.x = clientX; point.y = clientY;
  const matrix = map.getScreenCTM();
  return matrix ? point.matrixTransform(matrix.inverse()) : { x: 600, y: 400 };
}
let drag: { pointer: number; x: number; y: number } | undefined;
map.addEventListener("pointerdown", event => {
  if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".map-node"))) return;
  const point = mapPoint(event.clientX, event.clientY);
  drag = { pointer: event.pointerId, x: point.x, y: point.y };
  map.setPointerCapture(event.pointerId); map.classList.add("dragging");
});
map.addEventListener("pointermove", event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const point = mapPoint(event.clientX, event.clientY);
  void dispatch("map.pan", { x: point.x - drag.x, y: point.y - drag.y });
  drag.x = point.x; drag.y = point.y;
});
function endDrag() { drag = undefined; map.classList.remove("dragging"); }
map.addEventListener("pointerup", endDrag); map.addEventListener("pointercancel", endDrag); map.addEventListener("lostpointercapture", endDrag);
map.addEventListener("wheel", event => {
  event.preventDefault(); const point = mapPoint(event.clientX, event.clientY);
  void dispatch("map.zoom", { factor: Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .003), x: point.x, y: point.y });
}, { passive: false });

function getState() {
  return structuredClone({
    selected: state.selected, where: state.where, group: state.group, sort: state.sort, layout: state.layout,
    trail: [...state.trail], route: [...state.route], from: state.from, to: state.to,
    playing: state.playing, paused: state.paused, completed: state.completed, step: state.step, tempo: state.tempo, sound: sound.enabled,
    editing: state.editing, readerMode: state.readerMode, camera: { ...state.camera },
    sequence: state.atlas?.sequence ?? null, outline: state.atlas?.outline ?? null,
    records: state.atlas?.records ?? [], edges: state.atlas?.edges ?? [], groups: state.atlas?.groups ?? [], facets: state.atlas?.facets ?? [], completeness: state.atlas?.completeness ?? null,
    note: state.selected ? state.notes.get(state.selected) ?? null : null,
    drafts: Object.fromEntries([...state.drafts].map(([id, draft]) => [id, { ...draft }])),
    comments: Object.fromEntries([...state.comments].map(([id, draft]) => [id, { ...draft }])),
    busy: [...state.busy], notice: $("notice").textContent, scoreTitle: input("score-title").value,
    invalidated: [...state.invalidated], persistenceKey,
  });
}
declare global { interface Window { resonance: { dispatch: typeof dispatch; getState: typeof getState; select: (id: string) => Promise<unknown> }; } }
window.resonance = { dispatch, getState, select: id => dispatch("select", { id }) };
window.setInterval(() => { if (!document.hidden) void loadAtlas(); }, 8000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadAtlas(); else pause(); });
window.addEventListener("beforeunload", event => {
  if ([...state.drafts.values()].some(draft => draft.text !== draft.base) || [...state.comments.values()].some(draft => draft.text || draft.quote)) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("pagehide", () => { clearTimeout(scheduler); sound.dispose(); });
renderTrail(); renderRoute(); void loadAtlas(true);
