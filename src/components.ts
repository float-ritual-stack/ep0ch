// Document components: a fenced block whose language is `component:<name>` (```component:status) drawn
// by a renderer installed on the reader's host, as Detail draws it. A mirror of pi-herdr-outliner
// src/document-components.ts: the same registry (`OUTLINER_DOCUMENT_RENDERERS`, else
// `$XDG_CONFIG_HOME/pi-herdr-outliner/document-renderers.json`), the same bounded reads and schema, the
// same `label :: value` rows and the same reasons when it can't draw one. test/components.test.ts checks it
// against the service's own function. There is one layout, `labelled-values`; no plugin code runs.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const IDENTIFIER = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const LIMIT = 32 * 1024;

export type DocumentComponent =
  | { kind: "labelled-values"; entries: { label: string; value: string }[] }
  | { kind: "unavailable"; reason: string };

type Definition = { id: string; layout: "labelled-values" } | { kind: "unavailable"; reason: string };

/** A bounded local file: a regular file of at most 32 KiB, read without blocking on a FIFO. */
function readDefinition(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > LIMIT) throw new Error("invalid definition");
    const bytes = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length > LIMIT) throw new Error("invalid definition");
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally { closeSync(fd); }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/** The registry's shape, strictly (no extra keys, no conversion), as the service's TypeBox schema. */
function registryOf(v: unknown): Record<string, { manifest: string; enabled: boolean }> {
  if (!isObject(v) || !exactKeys(v, ["version", "renderers"]) || v.version !== 1 || !isObject(v.renderers)) throw new Error("invalid registry");
  const renderers = v.renderers;
  if (Object.keys(renderers).length > 64) throw new Error("invalid registry");
  for (const r of Object.values(renderers))
    if (!isObject(r) || !exactKeys(r, ["manifest", "enabled"]) || typeof r.manifest !== "string" || !r.manifest.length || typeof r.enabled !== "boolean") throw new Error("invalid registry");
  return renderers as Record<string, { manifest: string; enabled: boolean }>;
}

function manifestOf(v: unknown): { id: string; layout: "labelled-values" } {
  if (!isObject(v) || !exactKeys(v, ["contract", "id", "version", "renderer"]) || v.contract !== 1
    || typeof v.id !== "string" || !IDENTIFIER.test(v.id) || !Number.isInteger(v.version) || (v.version as number) < 1
    || !isObject(v.renderer) || !exactKeys(v.renderer, ["layout"]) || v.renderer.layout !== "labelled-values") throw new Error("invalid manifest");
  return { id: v.id, layout: "labelled-values" };
}

/**
 * The renderers one note load uses: each is resolved once, the first time a fence names it, and kept while
 * the note is read (a resize or a fold never reads the files again). Reopening the note starts a new one,
 * so an installation change shows then, as in Detail.
 */
export class ComponentCatalog {
  private readonly definitions = new Map<string, Definition>();
  private readonly registryPath = process.env.OUTLINER_DOCUMENT_RENDERERS
    ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pi-herdr-outliner", "document-renderers.json");

  resolve(name: string): Definition {
    let d = this.definitions.get(name);
    if (!d) { d = this.load(name); this.definitions.set(name, d); }
    return d;
  }

  private load(name: string): Definition {
    try {
      const registry = registryOf(readDefinition(this.registryPath));
      if (!Object.hasOwn(registry, name)) return { kind: "unavailable", reason: "renderer is not installed" };
      const install = registry[name]!;
      if (!install.enabled) return { kind: "unavailable", reason: "renderer is disabled" };
      if (!isAbsolute(install.manifest)) throw new Error("invalid manifest path");
      return manifestOf(readDefinition(install.manifest));
    } catch {
      return { kind: "unavailable", reason: "renderer installation is unavailable or invalid" };
    }
  }
}

/**
 * A fence's component, or null when its language isn't `component:…` (ordinary code). `body`: the lines
 * between the fences, as typed. Each nonblank line is `label :: value`; at most 64 of them and 16 KiB.
 */
export function documentComponent(language: string, body: string, catalog: ComponentCatalog): DocumentComponent | null {
  if (!language.startsWith("component:")) return null;
  const name = language.slice("component:".length);
  if (!IDENTIFIER.test(name)) return { kind: "unavailable", reason: "invalid renderer name" };
  const d = catalog.resolve(name);
  if ("kind" in d) return d;
  if (Buffer.byteLength(body, "utf8") > 16 * 1024) return { kind: "unavailable", reason: "component input exceeds 16 KiB" };
  const entries: { label: string; value: string }[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const m = /^(\s*)(\S(?:.*?\S)?)(\s+::\s+)(\S(?:.*?\S)?)\s*$/.exec(line);
    if (!m || entries.length >= 64) return { kind: "unavailable", reason: "expected up to 64 “label :: value” rows" };
    entries.push({ label: m[2]!, value: m[4]! });
  }
  return entries.length ? { kind: d.layout, entries } : { kind: "unavailable", reason: "component has no labelled values" };
}
