import { codeFenceLines } from "@ep0ch/outline-core/code-fence";
import { replacePropertyTokens } from "@ep0ch/outline-core/property-grammar";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { namesDemoIds, readDemo, rewriteDemoReferences, type Demo } from "./extension-demo";
import type { ExtensionManifest, LoadedExtension } from "./extension-manifest";
import { cleanExtensionText, extensionActorId } from "./extension-records";
import type { ExtensionEntry, ExtensionRegistry } from "./extension-registry";
import type { OutlinerStore } from "./store";
import type { Block, MutationProvenance } from "./types";

/**
 * Every extension has a page (Evan, Oct 10: "a page viewable within the system that explains and demonstrates how
 * it works"), under one **Extensions** hub in the outline. The service writes both from the extensions' folders,
 * never by hand, and again whenever the registry reloads (an extension added, updated or removed):
 *
 * - **The hub** (`Extensions [page::extensions]`, at the outline's root): the installed extensions, each a link to
 *   its page; those removed whose demo notes were kept; and those available from the repo's extension folder that
 *   aren't installed, each with its description and how to install it.
 * - **A page** per installed extension, under the hub: its name, description, version and state, its README drawn as
 *   the note's body (inert: a `key::` line or an `@name` in it is words, not a handler or a request), what it adds
 *   (handlers, actions, schedules, tiles, rules, agents, bar sources, component schemas, secrets, settings), and the
 *   head of its CHANGELOG. Its text is the service's: written again when what it's made from changes.
 * - **Its demo notes** (`demo` in the manifest, src/extension-demo.ts) as the page's children, written once as the
 *   extension (`ext:<id>`), with fresh ids and the demo's references rewritten to them. They are the person's from
 *   then on: never written again, a reinstall doesn't duplicate them, and a demo note added in a later version is
 *   added by itself. Uninstalling asks what becomes of them (`removeDemo`); nothing removes them silently.
 *
 * What it has written is kept in the outline's metadata (`extensions.pages`): the hub, each page, and each demo
 * note's block and the revision it was written at (an edit since is the person's, and is kept).
 */

const STATE_KEY = "extensions.pages";
const SYSTEM: MutationProvenance = { author: "system" };

interface Seeded { id: string; revision: number }
interface PagesState {
  hub?: string;
  /** Extension id → its page, and the name it had (said on the hub once it's gone). */
  pages: Record<string, { block: string; name: string }>;
  /** Extension id → the demo notes written for it, by their key in the demo. */
  demos: Record<string, { at: string; notes: Record<string, Seeded> }>;
}

/** An extension in the repo's folder that isn't installed here. */
export interface AvailableExtension {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly description?: string;
}

export interface ExtensionPagesOptions {
  /** The repo's extensions, the ones `ext add <name>` copies (extension-registry's BUILT_IN_EXTENSIONS). */
  readonly builtIns: string;
  readonly now?: () => Date;
}

/** What `removeDemo` did: notes moved to Trash, and the ones kept because someone changed them. */
export interface DemoRemoval { readonly trashed: number; readonly kept: readonly string[] }

const alive = (block: Block | null | undefined): block is Block => !!block && !block.effectiveDeletedRootId;

/** A line that would mean something (a `key::` handler line, an `@name` request) keeps its words without the meaning. */
const inertLineStart = (line: string) => line
  .replace(/^([ \t]*(?:[-*+][ \t]+)?[A-Za-z][A-Za-z0-9_.-]*)::/, "$1:‍:")
  .replace(/^([ \t]*(?:[-*+][ \t]+)?)@(?=[a-z])/, "$1@‍");

/**
 * Text from an extension's folder (a README, a description) as Blockdown that stays words: outside code fences a
 * `[key::value]` is escaped and a line start that would be a handler line or an `@name` request is broken with a
 * zero-width joiner. Fences are left as written (they are literal already). No terminal escapes.
 */
export function inertDocument(text: string): string {
  const lines = cleanExtensionText(text, true).split("\n");
  const fenced = codeFenceLines(lines);
  return lines.map((line, index) => fenced[index]! >= 0 ? line : inertLineStart(replacePropertyTokens(line, (token) => `\\${token.raw}`))).join("\n");
}

/** One line of an extension's words (a name, a description) for a list: inert, no line breaks. */
const words = (text: string | undefined) => inertDocument((text ?? "").replace(/\s+/g, " ").trim()).replace(/^@/, "@‍");

/** The README's body: its first `# ` heading (the page's title says the name) and the blank lines after it go. */
function readmeBody(readme: string): string {
  const lines = readme.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  while (start < lines.length && !lines[start]!.trim()) start++;
  if (/^#\s/.test(lines[start] ?? "")) start++;
  while (start < lines.length && !lines[start]!.trim()) start++;
  return inertDocument(lines.slice(start).join("\n").trimEnd());
}

/** The changelog's newest entry: from its first `## ` heading to the next (a CHANGELOG.md with one section per version). */
function changelogHead(changelog: string): string {
  const lines = changelog.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((line) => /^##\s/.test(line));
  if (first < 0) return inertDocument(lines.filter((line) => !/^#\s/.test(line)).join("\n").trim()).slice(0, 2_000);
  const next = lines.findIndex((line, index) => index > first && /^##\s/.test(line));
  return inertDocument(lines.slice(first, next < 0 ? undefined : next).join("\n").trim().replace(/^##\s/, "### "));
}

function readText(path: string, limit = 64 * 1024): string | undefined {
  try {
    if (!existsSync(path) || statSync(path).size > limit) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

const ON_WORDS = (on: string | undefined): string => {
  const target = on ?? "block";
  if (target.startsWith("handler:")) return `on a \`${target.slice(8)}::\` line`;
  if (target.startsWith("tile:")) return `in its ${target.slice(5)} tile`;
  return ({ block: "on a note", bar: "from a power bar row", passage: "on selected words", outline: "on the outline" } as Record<string, string>)[target] ?? target;
};
const scheduleWords = (schedule: { every?: string; cron?: string; once?: "host" } | undefined) =>
  schedule ? `, ${schedule.every ? `every ${schedule.every}` : `on cron ${schedule.cron}`}${schedule.once === "host" ? " (once per host)" : ""}` : "";

/** What a manifest adds, as list lines (the page's "What it adds"). */
export function whatItAdds(manifest: ExtensionManifest): string[] {
  const out: string[] = [];
  for (const handler of manifest.handlers ?? []) {
    out.push(`- \`${handler.key}::\` lines: ${handler.kind === "data" ? "a record kept as a block" : handler.kind === "output" ? "output drawn under the line" : handler.kind === "component" ? "a component drawn under the line" : "a Resource"} (${handler.effects})${scheduleWords(handler.schedule)}${handler.description ? `. ${words(handler.description)}` : ""}`);
  }
  for (const action of manifest.actions ?? []) {
    out.push(`- Action **${words(action.label)}** (\`ext.${manifest.id}.${action.id}\`, ${ON_WORDS(action.on)}${action.key ? `, key \`${action.key}\`` : ""}${action.effects === "write" ? ", writes" : ""}${scheduleWords(action.schedule)})${action.description ? `: ${words(action.description)}` : ""}`);
  }
  for (const tile of manifest.tiles ?? []) out.push(`- A tile: **${words(tile.name)}** (\`${manifest.id}.${tile.kind}\`)${tile.description ? `: ${words(tile.description)}` : ""}`);
  for (const rule of manifest.rules ?? []) {
    const match = Object.entries(rule.match).map(([key, value]) => `${key} \`${String(value).replaceAll("`", "'")}\``).join(", ");
    const does = [rule.decorate ? `draws ${rule.decorate.use ?? "a view"} ${rule.decorate.place ?? ""}`.trim() : "", rule.on ? `runs ${Object.entries(rule.on).filter(([key]) => key !== "quiet").map(([when, id]) => `${id} on ${when}`).join(", ")}` : ""].filter(Boolean).join(" and ");
    out.push(`- Rule \`${rule.id}\`: when a note matches ${match}, ${does || "nothing yet"}${rule.description ? `. ${words(rule.description)}` : ""}`);
  }
  for (const agent of manifest.agents ?? []) out.push(`- Agent \`@${agent.name}\`${agent.threads ? " (answers in comment threads)" : ""}${agent.description ? `: ${words(agent.description)}` : ""}`);
  for (const source of manifest.bar ?? []) out.push(`- Power bar rows: **${words(source.title)}**${source.prefix ? ` (prefix \`${source.prefix}\`)` : ""}${source.description ? `: ${words(source.description)}` : ""}`);
  for (const component of (manifest.components ?? []) as { key?: string; name?: string; title?: string }[]) {
    out.push(`- Component schema \`${component.key ?? component.name ?? "?"}\`${component.title ? `: ${words(component.title)}` : ""}`);
  }
  for (const [name, secret] of Object.entries(manifest.secrets ?? {})) {
    out.push(typeof secret === "string"
      ? `- Secret \`${name}\`: ${words(secret)}`
      : `- Secret \`${name}\`: with-secrets group \`${secret.group}\`, key \`${secret.key}\`${secret.description ? ` (${words(secret.description)})` : ""}`);
  }
  const settings = (manifest.configSchema as { properties?: Record<string, { description?: string }> } | undefined)?.properties;
  if (settings && Object.keys(settings).length) {
    out.push(`- Settings (\`config.json\`): ${Object.entries(settings).map(([key, spec]) => `\`${key}\`${spec?.description ? ` (${words(spec.description)})` : ""}`).join("; ")}`);
  }
  return out;
}

const STATE_WORDS = (entry: ExtensionEntry): string =>
  entry.state === "active" ? "installed"
  : entry.state === "disabled" ? "installed, turned off (config.json has enabled: false)"
  : `installed, failed to load: ${words(entry.error)}`;

export class ExtensionPages {
  private queue: Promise<void> = Promise.resolve();
  private available: AvailableExtension[] = [];
  /** Why the last write failed, if it did: said by `extensions.list`. */
  problem: string | undefined;

  constructor(
    private readonly store: OutlinerStore,
    private readonly registry: ExtensionRegistry,
    private readonly options: ExtensionPagesOptions,
  ) {}

  private read(): PagesState {
    try {
      const raw = this.store.readMetadata(STATE_KEY);
      const parsed = raw ? JSON.parse(raw) as Partial<PagesState> : {};
      return { ...(parsed.hub ? { hub: parsed.hub } : {}), pages: parsed.pages ?? {}, demos: parsed.demos ?? {} };
    } catch {
      return { pages: {}, demos: {} };
    }
  }

  private write(state: PagesState): void {
    const value = JSON.stringify(state);
    // Written only when it changed: a write to the outline is a change in its folder, which the registry may watch.
    if (value !== this.store.readMetadata(STATE_KEY)) this.store.writeMetadata(STATE_KEY, value);
  }

  private live(id: string | undefined): Block | null {
    const block = id ? this.store.get(id) : null;
    return alive(block) ? block : null;
  }

  /** The hub, when there is one. */
  hub(): string | undefined {
    return this.live(this.read().hub)?.id;
  }

  /** Each extension's page, by id. */
  pages(): Record<string, string> {
    const state = this.read();
    return Object.fromEntries(Object.entries(state.pages).flatMap(([id, page]) => this.live(page.block) ? [[id, page.block]] : []));
  }

  /** The repo's extensions not installed here, as of the last sync. */
  availableNow(): readonly AvailableExtension[] {
    return this.available;
  }

  private lastPrint = "";

  /**
   * What the pages are made from, cheaply: the registry's generation, each folder's README, CHANGELOG and demo files
   * (their times and sizes) and the repo's folder names. The registry reloads on any change under its folders (and,
   * watching a parent until a folder exists, on the outline's own writes): only a change to these writes again.
   */
  private fingerprint(): string {
    const stamp = (path: string): string => {
      try {
        const info = statSync(path);
        if (!info.isDirectory()) return `${info.mtimeMs}:${info.size}`;
        return readdirSync(path).sort().map((name) => `${name}=${stamp(join(path, name))}`).join(",");
      } catch {
        return "-";
      }
    };
    const parts: string[] = [String(this.registry.generation)];
    for (const entry of this.registry.list().extensions) {
      const demo = this.registry.loaded(entry.id)?.manifest.demo;
      parts.push(`${entry.id}|${entry.directory}|${stamp(join(entry.directory, "README.md"))}|${stamp(join(entry.directory, "CHANGELOG.md"))}|${demo ? stamp(join(entry.directory, demo)) : ""}`);
    }
    try { parts.push(readdirSync(this.options.builtIns).sort().join(",")); } catch { /* no repo folder */ }
    return parts.join("\n");
  }

  /** `sync`, when what the pages are made from changed since the last one (the registry's reloads call this). */
  syncIfChanged(): Promise<void> {
    const print = this.fingerprint();
    if (print === this.lastPrint) return this.queue;
    this.lastPrint = print;
    return this.sync();
  }

  /** Writes the hub and the pages again from the folders, and seeds demos not yet seeded. One at a time. */
  sync(): Promise<void> {
    const next = this.queue.then(() => this.syncOnce()).then(
      () => { this.problem = undefined; },
      (error) => { this.problem = error instanceof Error ? error.message : String(error); },
    );
    this.queue = next;
    return next;
  }

  private readAvailable(installed: ReadonlySet<string>): AvailableExtension[] {
    const root = this.options.builtIns;
    if (!existsSync(root)) return [];
    const out: AvailableExtension[] = [];
    for (const name of readdirSync(root).sort()) {
      if (installed.has(name)) continue;
      const text = readText(join(root, name, "extension.json"));
      if (!text) continue;
      try {
        const manifest = JSON.parse(text) as { id?: unknown; name?: unknown; version?: unknown; description?: unknown };
        if (manifest.id !== name || typeof manifest.name !== "string") continue;
        out.push({
          id: name, name: cleanExtensionText(manifest.name).trim(), version: typeof manifest.version === "number" ? manifest.version : 1,
          ...(typeof manifest.description === "string" ? { description: cleanExtensionText(manifest.description).trim() } : {}),
        });
      } catch {
        // A built-in that doesn't parse isn't offered.
      }
    }
    return out;
  }

  private async syncOnce(): Promise<void> {
    const listed = this.registry.list().extensions.filter((entry) => entry.state !== "shadowed");
    this.available = this.readAvailable(new Set(listed.map((entry) => entry.id)));
    const state = this.read();
    const installed = listed.map((entry) => ({ entry, loaded: this.registry.loaded(entry.id) }));
    // An outline with no extension, and no hub yet, gets none.
    if (!installed.length && !this.live(state.hub) && !Object.keys(state.pages).length) return;
    const now = (this.options.now?.() ?? new Date()).toISOString();
    try {
      this.store.changes.run(this.store.changes.attribution({ action: "extensions.pages", actor: SYSTEM }), () => {
        let hub = this.live(state.hub);
        if (!hub) {
          hub = this.store.create("Extensions [page::extensions]", null, "system");
          state.hub = hub.id;
        }
        const hubId = hub.id;
        for (const { entry, loaded } of installed) {
          const demo = loaded ? readDemo(loaded.directory, loaded.manifest.demo) : { notes: [] };
          const text = this.pageText(entry, loaded, demo);
          let page = this.live(state.pages[entry.id]?.block);
          if (!page) page = this.store.create(text, hubId, "system");
          else if (page.text !== text) page = this.store.update(page.id, text, page.revision, SYSTEM);
          state.pages[entry.id] = { block: page.id, name: loaded?.name ?? entry.name ?? entry.id };
          if (demo.notes.length) this.seed(state, entry.id, page.id, demo, now);
        }
        // An extension gone: its page stays while something is under it (demo notes kept, or the person's), else it goes.
        const present = new Set(installed.map(({ entry }) => entry.id));
        for (const [id, page] of Object.entries(state.pages)) {
          if (present.has(id)) continue;
          const block = this.live(page.block);
          if (block && this.store.children(block.id).length) {
            const text = this.removedText(id, page.name);
            if (block.text !== text) this.store.update(block.id, text, block.revision, SYSTEM);
            continue;
          }
          if (block) this.store.delete(block.id, SYSTEM);
          delete state.pages[id];
        }
        const hubText = this.hubText(state, installed.map(({ entry, loaded }) => ({ entry, loaded })));
        const current = this.store.require(hubId);
        if (current.text !== hubText) this.store.update(hubId, hubText, current.revision, SYSTEM);
      });
    } finally {
      this.write(state);
    }
  }

  /** The demo notes not yet written for this extension, under its page, as the extension. */
  private seed(state: PagesState, id: string, pageId: string, demo: Demo, now: string): void {
    const seeded = state.demos[id] ??= { at: now, notes: {} };
    const fresh = demo.notes.filter((note) => !seeded.notes[note.key]);
    if (!fresh.length) return;
    const ids = new Map<string, string>();
    for (const note of demo.notes) if (seeded.notes[note.key]) ids.set(note.id, seeded.notes[note.key]!.id);
    const actor: MutationProvenance = { author: "agent", actorId: extensionActorId(id) };
    this.store.changes.run(this.store.changes.attribution({ action: `ext.${id}.demo`, actor }), () => {
      for (const note of fresh) {
        const parent = note.parent ? this.live(seeded.notes[note.parent]?.id) : null;
        const block = this.store.create(rewriteDemoReferences(cleanExtensionText(note.text, true), ids), parent?.id ?? pageId, "agent", { actorId: actor.actorId! });
        ids.set(note.id, block.id);
        seeded.notes[note.key] = { id: block.id, revision: block.revision };
      }
      // A reference to a note written after it: written again now every id is known.
      for (const note of fresh) {
        if (!namesDemoIds(note.text, ids.keys())) continue;
        const record = seeded.notes[note.key]!;
        const block = this.store.require(record.id);
        const text = rewriteDemoReferences(cleanExtensionText(note.text, true), ids);
        if (text !== block.text) record.revision = this.store.update(block.id, text, block.revision, actor).revision;
      }
    });
  }

  /**
   * Moves an extension's demo notes to Trash (uninstall's "remove its demo notes"): each one no one has changed since it
   * was written, with nothing under it but such notes. One someone edited, or put a note under, stays, and is named.
   * The page goes too once nothing is left under it (on the next sync).
   */
  removeDemo(id: string, requestedBy?: MutationProvenance): DemoRemoval {
    const state = this.read();
    const seeded = state.demos[id];
    if (!seeded) return { trashed: 0, kept: [] };
    const records = Object.values(seeded.notes).map((record) => ({ record, block: this.live(record.id) }))
      .filter((entry): entry is { record: Seeded; block: Block } => !!entry.block);
    const seededIds = new Set(records.map((entry) => entry.block.id));
    const revisionOf = new Map(records.map((entry) => [entry.block.id, entry.record.revision]));
    const memo = new Map<string, boolean>();
    const clean = (blockId: string): boolean => {
      const known = memo.get(blockId);
      if (known !== undefined) return known;
      const block = this.store.require(blockId);
      const result = block.revision === revisionOf.get(blockId) &&
        this.store.children(blockId).every((child) => seededIds.has(child.id) && clean(child.id));
      memo.set(blockId, result);
      return result;
    };
    let trashed = 0;
    const kept: string[] = [];
    this.store.changes.run(this.store.changes.attribution({ action: "extensions.uninstall", actor: SYSTEM, ...(requestedBy ? { requestedBy } : {}) }), () => {
      for (const { block } of records) {
        if (!clean(block.id)) {
          if (block.revision !== revisionOf.get(block.id)) kept.push(block.text.split("\n")[0]!.replace(/\s*\[[^\]]*::[^\]]*\]/g, "").trim() || block.id);
          continue;
        }
        // Only the top of a clean subtree goes to Trash; what's under it goes with it (and comes back with a restore).
        if (block.parentId && seededIds.has(block.parentId) && clean(block.parentId)) continue;
        this.store.delete(block.id, SYSTEM);
        trashed++;
      }
    });
    delete state.demos[id];
    this.write(state);
    return { trashed, kept };
  }

  /** How many of an extension's demo notes are still in the outline. */
  demoCount(id: string): number {
    const seeded = this.read().demos[id];
    return seeded ? Object.values(seeded.notes).filter((record) => this.live(record.id)).length : 0;
  }

  private pageText(entry: ExtensionEntry, loaded: LoadedExtension | undefined, demo: Demo): string {
    const name = words(loaded?.name ?? entry.name ?? entry.id) || entry.id;
    const lines = [`${name} [ext.page::${entry.id}] [page::ext-${entry.id}]`];
    if (loaded?.description ?? entry.description) lines.push(words(loaded?.description ?? entry.description));
    lines.push(`\`${entry.id}\` · version ${loaded?.version ?? entry.version ?? "?"} · ${STATE_WORDS(entry)} · ${entry.origin === "outline" ? "this outline's own" : "for every outline this host serves"}`);
    const directory = loaded?.directory ?? entry.directory;
    const readme = readText(join(directory, "README.md"));
    if (readme?.trim()) lines.push("", readmeBody(readme));
    if (loaded) {
      const adds = whatItAdds(loaded.manifest);
      if (adds.length) lines.push("", "## What it adds", "", ...adds);
    }
    const changelog = readText(join(directory, "CHANGELOG.md"));
    if (changelog?.trim()) lines.push("", "## Changelog", "", changelogHead(changelog));
    if (demo.problem) lines.push("", "## Demo", "", `Its demo can't be written: ${words(demo.problem)}`);
    else if (demo.notes.length) lines.push("", "## Demo", "", "Its demo notes are under this page. They're yours: change them freely; a reinstall never writes over them or adds them twice.");
    lines.push("", `Remove it: \`ep0ch ext remove ${entry.id}\` (its demo notes stay unless you add \`--demo remove\`), or in the door the power bar's extensions (ctrl+k then &).`);
    return lines.join("\n");
  }

  private removedText(id: string, name: string): string {
    return [
      `${words(name) || id} [ext.page::${id}] [page::ext-${id}]`,
      `\`${id}\` · not installed. What was under its page is kept below.`,
      "",
      `Install it again: \`ep0ch ext add ${id}\` (its demo notes aren't added twice), or in the door the power bar's extensions (ctrl+k then &).`,
    ].join("\n");
  }

  private hubText(state: PagesState, installed: readonly { entry: ExtensionEntry; loaded: LoadedExtension | undefined }[]): string {
    const lines = [
      "Extensions [page::extensions]",
      "What this outline's extensions add, and what you can add. The outline service writes this page from each extension's folder, and again when one is added, updated or removed: each page below has its README, what it adds and its demo notes.",
      "",
      "## Installed",
      "",
    ];
    if (!installed.length) lines.push("None yet.");
    for (const { entry, loaded } of installed) {
      const page = state.pages[entry.id]?.block;
      const name = words(loaded?.name ?? entry.name ?? entry.id) || entry.id;
      const state_ = entry.state === "active" ? "" : entry.state === "disabled" ? " · turned off" : " · failed to load";
      lines.push(`- ${page ? `((${page}|${name.replaceAll("|", "/").replaceAll(")", "]")}))` : name} \`${entry.id}\` v${loaded?.version ?? entry.version ?? "?"}${state_}${loaded?.description ?? entry.description ? `: ${words(loaded?.description ?? entry.description)}` : ""}`);
    }
    const present = new Set(installed.map(({ entry }) => entry.id));
    const gone = Object.entries(state.pages).filter(([id]) => !present.has(id));
    if (gone.length) {
      lines.push("", "## Removed, notes kept", "");
      for (const [id, page] of gone) lines.push(`- ((${page.block}|${(words(page.name) || id).replaceAll("|", "/").replaceAll(")", "]")})) \`${id}\``);
    }
    lines.push("", "## Available", "");
    if (!this.available.length) lines.push("Every extension in the repo's folder is installed.");
    for (const extension of this.available) {
      lines.push(`- **${words(extension.name)}** \`${extension.id}\` v${extension.version}${extension.description ? `: ${words(extension.description)}` : ""}`);
    }
    lines.push("", "Install one with its demo notes: in the door, the power bar's extensions (ctrl+k then &; ⏎ or a click installs the row); an agent `act extensions.install id=<id>`; a shell `ep0ch ext add <id>`.");
    return lines.join("\n");
  }
}
