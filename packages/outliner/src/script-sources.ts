import { actionSlots } from "@ep0ch/outline-core/action-line";
import { codeBlocks } from "@ep0ch/outline-core/code-fence";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ManifestSource, ScriptSource } from "./extension-manifest";
import type { OutlinerStore } from "./store";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Sources stay authored text; a malformed fence is reported by the loader, never by saving the block. */
export async function scriptSources(store: OutlinerStore): Promise<ManifestSource[]> {
  const sources: ManifestSource[] = [];
  const add = (identity: string, name: string, script: ScriptSource, error?: string) => {
    const id = `script-${hash(identity).slice(0, 24)}`;
    sources.push({
      ...(error ? { error } : {}), expectedId: id, idFrom: identity, origin: "outline", directory: store.workspaceRoot ?? "",
      manifestRaw: JSON.stringify({ contract: 2, id, version: 1, name, ...(/^[a-z][a-z0-9-]{0,31}$/.test(name) ? { agents: [{ name, effects: script.effects }] } : {}), actions: [{ id: "run", label: `Run ${name}`, description: `Runs saved revision ${script.revision} as script:${name}; progress goes into a run note`, on: "outline", effects: script.effects, ...(script.format === "actions" ? { args: actionSlots(script.code).map(name => ({ name, type: "text", required: true })) } : {}) }] }),
      configRaw: "{}", script, stamp: hash(JSON.stringify(script)),
    });
  };
  const found = store.queryBlocks({ where: "script", limit: 1000 });
  for (const row of found.blocks) {
    const block = store.get(row.id)!;
    const name = block.properties.find(p => p.key === "script")?.value;
    if (!name) continue;
    const lines = block.text.split("\n");
    const fence = codeBlocks(lines).fences.find(f => ["js", "javascript", "ts", "typescript", "actions"].includes(f.fence.info));
    const code = fence?.closed ? lines.slice(fence.start + 1, fence.end).map(line => line.slice(Math.min(fence.fence.indent, line.length))).join("\n") : "";
    const revision = store.revisions(block.id).revisions[0]!;
    add(block.id, name, { code, keys: block.properties.filter(p => p.key === "keys").flatMap(p => p.value.split(",").map(k => k.trim()).filter(Boolean)), ...(fence?.fence.info === "actions" ? { format: "actions" as const } : {}), blockId: block.id, revision: block.revision,
      effects: block.properties.some(p => p.key === "effects" && p.value === "write") ? "write" : "read", author: { author: revision.author ?? block.author, ...(revision.actorId ? { actorId: revision.actorId } : {}) } });
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
        const code = dotted ? await Bun.file(file).text() : "";
        const header = /^\s*\/\/ ep0ch-script(?: effects=(read|write))?\s*$/.exec(code.split(/\r?\n/)[0] ?? "");
        const error = !dotted ? `${file}: ignored; scripts load only from .ep0ch/scripts/. Move it there only if you intend to run it, and opt in with // ep0ch-script.`
          : !header ? `${file}: ignored; opt in with a first line of // ep0ch-script (or // ep0ch-script effects=write).` : undefined;
        add(file, name.replace(/\.(ts|js)$/, ""), { code, file, revision: hash(code), effects: header?.[1] === "write" ? "write" : "read", author: { author: "user" } }, error);
      }
    }
  }
  return sources;
}
