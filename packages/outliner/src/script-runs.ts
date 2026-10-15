import { createPatch } from "diff";
import type { AgentToolsClient } from "./agent-tools";
import type { ExtensionActRequest, ExtensionActResult } from "./extension-calls";
import type { LoadedExtension } from "./extension-manifest";
import type { ExtensionRegistry } from "./extension-registry";
import type { ExtensionWrites } from "./extension-writes";
import { hostApi, type HostStep } from "./host-api";
import { runScript } from "./script-runtime";
import type { OutlinerStore } from "./store";
import type { Block, MutationProvenance, OutlinerChange } from "./types";

/** Runs outlive the action that starts them; progress is ordinary outline content beside the source. */
export class ScriptRuns {
  private readonly running = new Set<AbortController>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly captures = new Map<string, { actor: MutationProvenance; run: <T>(work: () => T) => T }>();

  capture<T>(id: string, work: (actor: MutationProvenance) => T): T {
    const capture = this.captures.get(id);
    if (!capture) throw new Error("This script run has ended");
    return capture.run(() => work(capture.actor));
  }

  private readonly previous = new Map<string, string>();

  constructor(private readonly store: OutlinerStore, private readonly registry: ExtensionRegistry,
    private readonly writes: ExtensionWrites, private readonly client: AgentToolsClient,
    private readonly publish: (changes: readonly OutlinerChange[]) => void,
    private readonly inverse: (run: string) => Promise<import("./draft-patch").DraftPatchEdit[]>,
    private readonly act: (clientId: string, name: string, args: Record<string, unknown>, actor: MutationProvenance, signal: AbortSignal) => Promise<unknown>) {}

  start(extension: LoadedExtension, request: ExtensionActRequest): ExtensionActResult {
    const source = extension.script!;
    const undo = this.writes.beginRun(`script:${extension.name}`);
    const actor: MutationProvenance = { ...(request.mcpAccess ? request.requestedBy! : source.author), sessionId: undo, taskId: `trigger:script:${extension.id}` };
    const requestedBy = request.requestedBy ?? { author: "user" as const };
    const controller = new AbortController();
    this.running.add(controller);
    const old = this.previous.get(extension.id);
    this.previous.set(extension.id, source.code);
    const lines = [
      `${extension.name} · working [script-run::${undo}]`,
      `Author: ${actor.actorId ?? actor.author} · revision ${source.revision} · onBehalfOf: ${requestedBy.actorId ?? requestedBy.author}`,
      ...(old !== undefined && old !== source.code ? ["", "```diff", createPatch(extension.name, old, source.code), "```"] : []),
    ];
    const captured = <T>(work: () => T): T => {
      const before = new Map<string, Block>();
      const attribution = this.store.changes.attribution({ action: `script:${extension.name}`, actor, requestedBy, collect: true });
      const finish = () => {
        const changes = this.store.changes.committed(attribution);
        this.writes.recordRun(undo, before, changes);
        this.publish(changes);
      };
      try {
        const value = this.store.withBeforeImages(before, () => this.store.changes.run(attribution, work));
        if (value instanceof Promise) return value.finally(finish) as T;
        finish();
        return value;
      } catch (error) { finish(); throw error; }
    };
    this.captures.set(undo, { actor, run: captured });
    const log = captured(() => this.store.create(lines.join("\n"), source.blockId ?? request.blockId ?? null, actor.author,
      actor.author === "agent" ? { actorId: actor.actorId ?? "agent", sessionId: undo, taskId: actor.taskId } : undefined));
    const update = () => captured(() => {
      const now = this.store.require(log.id);
      this.store.update(log.id, lines.join("\n"), now.revision, actor);
    });
    const step = (s: HostStep) => {
      if (s.phase === "start") return;
      lines.push(`\n${s.seq}. ${s.tool}: ${s.phase === "done" ? JSON.stringify(s.result) : s.error}`);
      update();
    };
    const client: AgentToolsClient = {
      requireCompatibleService: () => this.client.requireCompatibleService(),
      request: async input => {
        const changed = source.blockId
          ? this.store.get(source.blockId)?.revision !== source.revision
          : await Bun.file(source.file!).text() !== source.code;
        if (changed) {
          controller.abort();
          throw new Error("The script source changed; run its saved revision again");
        }
        return captured(() => this.client.request(input));
      },
    };
    const api = hostApi(client, { ...actor, actorId: actor.actorId ?? actor.author }, {
      onStep: step,
      mcpAccess: request.mcpAccess,
      ...(request.clientId ? { act: (name: string, args: Record<string, unknown>) => this.act(request.clientId!, name, args, actor, controller.signal) } : {}),
    });
    const task = (async () => {
      try {
        const result = await runScript(source.code, api, controller.signal);
        const current = this.registry.extension(extension.id);
        if (!current || current.stamp !== extension.stamp) throw new Error("The script source changed during this run; its remaining output was discarded. Run the saved revision again.");
        lines[0] = `${extension.name} · ${result.ok ? "done" : "failed"} [script-run::${undo}]`;
        for (const output of result.output) if (output.type === "text") lines.push(output.text);
        if (result.ok) { if (result.value !== undefined) lines.push(JSON.stringify(result.value)); }
        else lines.push(result.error.message);
      } catch (error) {
        lines[0] = `${extension.name} · failed [script-run::${undo}]`;
        lines.push(error instanceof Error ? error.message : String(error));
      } finally {
        controller.abort();
        try {
          const drafts = await this.inverse(undo);
          this.writes.finishRun(undo, drafts);
        } catch (error) {
          const problem = error instanceof Error ? error.message : String(error);
          lines.push(`Undo unavailable: ${problem}`);
          this.writes.finishRun(undo, [], problem);
        }
        try { update(); } finally {
          this.captures.delete(undo);
          this.running.delete(controller);
        }
      }
    })();
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task)).catch(() => {});
    return { extension: extension.id, action: "run", message: `running as ${actor.actorId ?? actor.author}; results in ((${log.id}))`, written: [log.id], undo, undoOn: source.blockId ?? log.id, writtenAs: actor.actorId ?? actor.author };
  }

  async stop(): Promise<void> {
    for (const run of this.running) run.abort();
    await Promise.allSettled(this.tasks);
  }
}
