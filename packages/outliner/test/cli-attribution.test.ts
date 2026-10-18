// PIE-890: whoever writes through the CLI is recorded as who it is. An agent says who it is with --actor (the mod passes
// --author agent too); `--actor loki` alone used to be stored author=user, so an agent's property edit read as the person's.
// Every write form the CLI has, against a private scratch service, as spawned processes. Fictional notes.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchOutline } from "./scratch-outline";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-cli-who-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const cliEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !/^(HERDR_|OUTLINER_|EP0CH_)/.test(key)) cliEnv[key] = value;
  Object.assign(cliEnv, env);
  const cli = async (args: string[]) => {
    const child = Bun.spawn(["bun", "src/cli.ts", ...args], { cwd: join(import.meta.dir, ".."), env: cliEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stdout, stderr };
  };
  store.configureWorkIdPrefix("PIE");
  store.create("Work [type::work-queue] [project::garden]");
  const [item, stageItem] = await Promise.all(["Turn the heap", "Plant the beds"].map(async title =>
    JSON.parse((await cli(["work", "create", "--title", title, "--project", "garden", "--arc", "beds", "--track", "beds", "--priority", "low", "--author", "agent", "--actor", "setup"])).stdout) as { workId: string; blockId: string }
  ));
  return { store, cli, item: item!, stageItem: stageItem! };
}

/** The last change recorded on a block: who the feed says made it. */
const lastChange = (store: OutlinerStore, id: string) => {
  const page = store.changes.since(0, 1000);
  const changes = page.kind === "changes" ? page.changes : [];
  const last = changes.filter(change => change.blockId === id).at(-1);
  return last?.actor ? { author: last.actor.author, actorId: last.actor.actorId } : null;
};

/** Only the fields the case names (the person's default label is the CLI's business). */
const pick = (got: { author?: string; actorId?: string } | null, want: { author: string; actorId?: string }) => ({ author: got?.author, ...(want.actorId !== undefined ? { actorId: got?.actorId } : {}) });

test("every CLI write form: --actor alone is an agent, nothing is the person, --author says what it says", async () => {
  const { store, cli, item, stageItem } = await setup();
  const note = store.create("Compost rota"), moving = store.create("Seed list"), other = store.create("Bed plan");
  const cases: Array<[string[], { author: "user" | "agent"; actorId?: string }]> = [
    [["--actor", "loki"], { author: "agent", actorId: "loki" }],
    [[], { author: "user" }],   // the person at the terminal: author user, whatever the CLI labels itself
    [["--author", "user"], { author: "user" }],
    [["--author", "agent", "--actor", "loki"], { author: "agent", actorId: "loki" }],
  ];
  let n = 0;
  for (const [who, expected] of cases) {
    n += 1;
    const forms: Array<{ form: string; args: string[]; block: string }> = [
      { form: "work set", args: ["work", "set", item.workId, "arc", `paths${n}`], block: item.blockId },
      { form: "work stage", args: ["work", "stage", stageItem.workId, n % 2 ? "doing" : "queued"], block: stageItem.blockId },
      { form: "update", args: ["update", "--id", note.id, "--text", `Compost rota ${n}`, "--expected", String(store.require(note.id).revision)], block: note.id },
      { form: "move", args: ["move", "--id", moving.id, "--expected", String(moving.revision), "--parent", n % 2 ? other.id : "root"], block: moving.id },
    ];
    // Each form owns its target so concurrent writes cannot race revisions or overwrite attribution.
    await Promise.all([
      ...forms.map(async form => {
        const ran = await cli([...form.args, ...who]);
        expect({ form: form.form, who: who.join(" "), exit: ran.exitCode, err: ran.stderr }).toEqual({ form: form.form, who: who.join(" "), exit: 0, err: "" });
        expect({ form: form.form, who: who.join(" "), ...pick(lastChange(store, form.block), expected) }).toEqual({ form: form.form, who: who.join(" "), ...expected });
      }),
      // The creating forms print the new block.
      ...[["create", "--text", `A fresh note ${n}`], ["new", "--text", `Another fresh note ${n}`]].map(async args => {
        const ran = await cli([...args, ...who]);
        expect({ args: args[0], exit: ran.exitCode, err: ran.stderr }).toEqual({ args: args[0], exit: 0, err: "" });
        const made = JSON.parse(ran.stdout) as { id?: string; blockId?: string; block?: { id: string } };
        expect({ form: args[0], who: who.join(" "), ...pick(lastChange(store, made.id ?? made.blockId ?? made.block!.id), expected) }).toEqual({ form: args[0], who: who.join(" "), ...expected });
      }),
    ]);
  }
});

test("--author agent without --actor is refused; a comment, a trash and its restore are the agent's with --actor", async () => {
  const { store, cli } = await setup();
  const refused = await cli(["update", "--id", "x", "--text", "y", "--expected", "1", "--author", "agent"]);
  expect(refused.exitCode).not.toBe(0);
  expect(refused.stderr).toContain("--author agent requires --actor");
  const note = store.create("Compost rota\n\nTurn it weekly.");
  const commented = await cli(["comment", "--id", note.id, "--expected", String(note.revision), "--request-id", "c-1", "--whole", "--text", "Looks right.", "--actor", "loki"]);
  expect(commented.exitCode, commented.stderr).toBe(0);
  expect(JSON.stringify(JSON.parse(commented.stdout))).toContain("loki");
  const trashed = await cli(["delete", "--id", note.id, "--actor", "loki"]);
  expect(trashed.exitCode, trashed.stderr).toBe(0);
  expect(lastChange(store, note.id)).toEqual({ author: "agent", actorId: "loki" });
  const restored = await cli(["restore", "--id", note.id, "--actor", "loki"]);
  expect(restored.exitCode, restored.stderr).toBe(0);
  expect(lastChange(store, note.id)).toEqual({ author: "agent", actorId: "loki" });
});
