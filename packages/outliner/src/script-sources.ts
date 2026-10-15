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
  const add = (identity: string, name: string, script: ScriptSource) => {
    const id = `script-${hash(identity).slice(0, 24)}`;
    sources.push({
      expectedId: id, idFrom: identity, origin: "outline", directory: store.workspaceRoot ?? "",
      manifestRaw: JSON.stringify({ contract: 2, id, version: 1, name, actions: [{ id: "run", label: `Run ${name}`, description: `Runs saved revision ${script.revision} as ${script.author.actorId ?? script.author.author}; progress goes into a run note`, on: "outline", effects: "write" }] }),
      configRaw: "{}", script, stamp: hash(JSON.stringify(script)),
    });
  };
  const found = store.queryBlocks({ where: "script", limit: 1000 });
  for (const row of found.blocks) {
    const block = store.get(row.id)!;
    const name = block.properties.find(p => p.key === "script")?.value;
    if (!name) continue;
    const lines = block.text.split("\n");
    const fence = codeBlocks(lines).fences.find(f => ["js", "javascript", "ts", "typescript"].includes(f.fence.info));
    const code = fence?.closed ? lines.slice(fence.start + 1, fence.end).map(line => line.slice(Math.min(fence.fence.indent, line.length))).join("\n") : "";
    const revision = store.revisions(block.id).revisions[0]!;
    add(block.id, name, { code, blockId: block.id, revision: block.revision,
      author: { author: revision.author ?? block.author, ...(revision.actorId ? { actorId: revision.actorId } : {}) } });
  }
  if (store.workspaceRoot) {
    const folder = join(store.workspaceRoot, "scripts");
    let names: string[];
    try { names = await readdir(folder); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      names = [];
    }
    for (const name of names.sort()) {
      if (!/\.(ts|js)$/.test(name)) continue;
      const file = join(folder, name);
      const code = await Bun.file(file).text();
      add(file, name.replace(/\.(ts|js)$/, ""), { code, file, revision: hash(code), author: { author: "user" } });
    }
  }
  return sources;
}
