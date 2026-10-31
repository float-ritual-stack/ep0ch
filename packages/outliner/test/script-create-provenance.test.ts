// PIE-1464: a note, a comment and a reply a script creates record the press the way a property set does: the person (or
// the agent) who asked for the run as the writer, the script as how. Read back as `ep0ch revisions` prints it
// (outline-core's revisionByline) and from the change feed. Scratch service; every note and name is made up.
import { expect, test } from "bun:test";
import { revisionByline } from "@ep0ch/outline-core/attribution";
import { setup, until } from "./script-harness";

const MAKER = (tag: string) => `Maker ${tag} [script::make-${tag}] [effects::write]
\`\`\`js
const n = await tools.outline_create({ parent: 'root', text: 'Oat sacks ' + '${tag}' });
const c = await tools.outline_comment({ ref: n.id, body: 'Counted ' + '${tag}', whole: true });
await tools.outline_reply({ thread: c.thread, body: 'Recounted ' + '${tag}' });
return n.id;
\`\`\``;

test("a note, comment and reply a pressed script makes read 'by you · via script', or the agent's 'via script'", async () => {
  const { store, client, create, extensionOf } = await setup();
  const press = async (tag: string, mutation: { author: "user" | "agent"; actorId?: string }) => {
    create(MAKER(tag));
    const extension = await extensionOf(`make-${tag}`);
    const run = await client.request<{ undo: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run", mutation });
    const made = await until(`${tag}'s note`, () => store.queryBlocks({ where: `text~"Oat sacks ${tag}"` }).blocks[0]);
    await until(`${tag}'s reply`, () => store.queryBlocks({ where: `text~"Recounted ${tag}"` }).blocks[0]);
    return { run, made, mine: store.queryBlocks({ where: `text~"Counted ${tag}" OR text~"Recounted ${tag}"` }).blocks };
  };
  const byline = (id: string) => {
    const first = store.revisions(id).revisions.at(-1)!;
    return { first, line: revisionByline(first) };
  };

  const person = await press("p", { author: "user" });
  expect(byline(person.made.id)).toMatchObject({ line: "by you · via script", first: { author: "user" } });
  expect(person.mine.length).toBe(2);
  for (const b of person.mine) expect(revisionByline({ author: b.author, actorId: b.actorId, taskId: b.taskId })).toBe("by you · via script");
  const page = store.changes.since(0, 1000);
  const change = page.kind === "changes" ? page.changes.find(c => c.blockId === person.made.id && c.kind === "create") : undefined;
  expect(change).toMatchObject({ action: "script:make-p", actor: { author: "user", taskId: expect.stringContaining("trigger:script:") } });

  const agent = await press("a", { author: "agent", actorId: "kitty-press" });
  expect(byline(agent.made.id)).toMatchObject({ line: "by kitty-press · via script", first: { author: "agent", actorId: "kitty-press" } });
});
