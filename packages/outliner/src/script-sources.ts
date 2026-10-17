import { actionSlots } from "@ep0ch/outline-core/action-line";
import { codeBlocks } from "@ep0ch/outline-core/code-fence";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { durationMs, MAX_DEADLINE_MS, type ManifestSource, type ScriptSource } from "./extension-manifest";
import type { OutlinerStore } from "./store";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

const FENCES = ["js", "javascript", "ts", "typescript", "actions"];

/** The script a note holds: the code of its first closed js, ts or actions fence (empty when there is none). */
export function scriptFence(text: string): { code: string; format?: "actions" } {
  const lines = text.split("\n");
  const fence = codeBlocks(lines).fences.find(f => FENCES.includes(f.fence.info));
  const code = fence?.closed ? lines.slice(fence.start + 1, fence.end).map(line => line.slice(Math.min(fence.fence.indent, line.length))).join("\n") : "";
  return { code, ...(fence?.fence.info === "actions" ? { format: "actions" as const } : {}) };
}

/** The names a js script reads from `props` (`props.week`, `props["week"]`): the slots it takes (`week=42`). */
export function propsUsed(code: string): string[] {
  return [...new Set([...code.matchAll(/\bprops(?:\.([A-Za-z_][\w-]*)|\[\s*["']([^"'\]]+)["']\s*\])/g)].map(m => (m[1] ?? m[2])!))];
}

/** What identifies a script's source: its code and settings, never its note's revision (a script may write into its own note). */
/** `reads` is the version of what a render records of the notes it read: a change draws every render script again. */
const scriptStamp = (script: ScriptSource) => hash(JSON.stringify({ ...script, revision: undefined, author: undefined, reads: 2 }));

/** Sources stay authored text; a malformed fence is reported by the loader, never by saving the block. */
export async function scriptSources(store: OutlinerStore): Promise<ManifestSource[]> {
  const sources: ManifestSource[] = [];
  const add = (identity: string, name: string, script: ScriptSource, error?: string) => {
    const id = `script-${hash(identity).slice(0, 24)}`;
    sources.push({
      ...(error ? { error } : {}), expectedId: id, idFrom: identity, origin: "outline", directory: store.workspaceRoot ?? "",
      manifestRaw: JSON.stringify({ contract: 2, id, version: 1, name, ...(/^[a-z][a-z0-9-]{0,31}$/.test(name) ? { agents: [{ name, effects: script.effects }] } : {}),
        // Render mode: the script is a handler, its line (`name::`) draws what it returns under the line.
        ...(script.render ? { handlers: [{ key: name, kind: "output", effects: "read", description: `Draws what ${name} returns, in place`, argument: { name: "slots", description: "name=value words the script reads as props" } }] } : {}),
        actions: [{ id: "run", label: `Run ${name}`, description: `Runs saved revision ${script.revision} as script:${name}; progress goes into a run note`, on: "outline", effects: script.effects,
          args: (script.format === "actions" ? actionSlots(script.code).map(slot => ({ name: slot.name, type: "text", ...(slot.required ? { required: true } : {}) })) : propsUsed(script.code).map(name => ({ name, type: "text" }))) }] }),
      configRaw: "{}", script, stamp: scriptStamp(script),
    });
  };
  const found = store.queryBlocks({ where: "script", limit: 1000 });
  for (const row of found.blocks) {
    const block = store.get(row.id)!;
    const name = block.properties.find(p => p.key === "script")?.value;
    if (!name) continue;
    const { code, format } = scriptFence(block.text);
    const revision = store.revisions(block.id).revisions[0]!;
    const effects = block.properties.some(p => p.key === "effects" && p.value === "write") ? "write" as const : "read" as const;
    const render = block.properties.some(p => p.key === "mode" && p.value === "render");
    const deadline = durationMs(block.properties.find(p => p.key === "deadline")?.value);
    // Render mode draws a view; a view never writes. Said at load, so the script is listed with why it isn't served.
    const problem = render && effects === "write" ? `Script ${name} is [mode::render], which draws a view and never writes: remove [effects::write], or remove [mode::render] to run it as an action` : undefined;
    add(block.id, name, { code, keys: block.properties.filter(p => p.key === "keys").flatMap(p => p.value.split(",").map(k => k.trim()).filter(Boolean)), ...(format ? { format } : {}), blockId: block.id, revision: block.revision,
      ...(render ? { render: true as const } : {}), ...(deadline ? { deadlineMs: Math.min(deadline, MAX_DEADLINE_MS) } : {}),
      effects, author: { author: revision.author ?? block.author, ...(revision.actorId ? { actorId: revision.actorId } : {}) } }, problem);
  }
  if (store.workspaceRoot) {
    for (const dotted of [false, true]) {
      const folder = dotted ? join(store.workspaceRoot, ".ep0ch", "scripts") : join(store.workspaceRoot, "scripts");
      let names: string[];
      try { names = await readdir(folder); } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        names = [];
      }
      for (const name of names.sort()) {
        if (!/\.(ts|js)$/.test(name)) continue;
        const file = join(folder, name);
        let code = "";
        if (dotted) {
          try { code = await Bun.file(file).text(); } catch (error) {
            add(file, name.replace(/\.(ts|js)$/, ""), { code, file, revision: hash(code), effects: "read", author: { author: "user" } }, `${file}: cannot read script: ${error instanceof Error ? error.message : String(error)}`);
            continue;
          }
        }
        const header = /^\s*\/\/ ep0ch-script(?: effects=(read|write))?\s*$/.exec(code.split(/\r?\n/)[0] ?? "");
        const error = !dotted ? `${file}: ignored; scripts load only from .ep0ch/scripts/. Move it there only if you intend to run it, and opt in with // ep0ch-script.`
          : !header ? `${file}: ignored; opt in with a first line of // ep0ch-script (or // ep0ch-script effects=write).` : undefined;
        add(file, name.replace(/\.(ts|js)$/, ""), { code, file, revision: hash(code), effects: header?.[1] === "write" ? "write" : "read", author: { author: "user" } }, error);
      }
    }
  }
  return sources;
}
