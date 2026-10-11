import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Room, isolatedEnv, outlineCommand } from "./room";

const [mode, directory] = process.argv.slice(2);
if (!["init", "serve"].includes(mode ?? "") || !directory) {
  console.error("Usage: bun spikes/tern-return-room/demo.ts init|serve <private-directory>");
  process.exit(2);
}
const home = resolve(directory);
const configPath = join(home, "room.json");
const outlines = join(home, "outlines");
await mkdir(outlines, { recursive: true, mode: 0o700 });
const env = isolatedEnv(outlines);
for (const key of Object.keys(process.env)) if (/^(EP0CH_|OUTLINER_|HERDR_)/.test(key)) delete process.env[key];
Object.assign(process.env, env);
// Host imports read process configuration at module load; isolate it before loading
// application code so a demo cannot initialize the person's extensions or services.
// This file is the outliner package's public outline-host export; spikes aren't workspaces.
const { OutlineHost } = await import("../../packages/outliner/src/outline-host");
const host = new OutlineHost({ outlinesFolder: outlines });
if (mode === "init") {
  if (await Bun.file(configPath).exists()) throw new Error(`Refusing to overwrite ${configPath}; use serve or choose a new private directory.`);
  await host.start();
  try {
    await outlineCommand(outlines, "return-room", ["outline", "create", "return-room", "--json"]);
    const root = await outlineCommand(outlines, "return-room", ["create", "--text",
      "The observatory after midnight [return-kind::room]\n\nA fictional handoff: a listening station for a small public garden. No real workboard items.",
      "--author", "agent", "--actor", "return-room:demo"]);
    await writeFile(configPath, JSON.stringify({ version: 1, outlines, outline: "return-room", room: root.id,
      drafts: join(home, "drafts") }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    process.env.RETURN_ROOM_CONFIG = configPath;
    const room = await Room.fromEnv();
    const evidence = join(home, "field-recording.txt");
    await writeFile(evidence, "Fictional observation log\n\n18:10  Visitor could name a bird but could not find yesterday's recording.\n18:18  A paper map drew three people into a conversation.\n18:31  A list of timestamps drew nobody.\n\nThis is authored demo material, not a study or a measured result.\n");
    const examples = [
      { kind: "finding", title: "The return is a place, not a timestamp", body: "People come back to a question, not to the end of a transcript. Give each expedition a room whose evidence stays put while the conversation keeps moving.\n\nHypothesis, not measured evidence: a stable spatial handoff lowers the cost of returning after a day away." },
      { kind: "option", title: "A cabinet of listening cards", body: "One card for each recording, question or surprising connection. Keep the original beside its interpretation. A visitor can leave a response without becoming the operator of the whole system.\n\nTradeoff: very legible at a dozen cards; a larger collection needs the outline's existing queries rather than another filter language." },
      { kind: "option", title: "A river of unfinished conversations", body: "Walk across linked questions rather than a feed. Each choice opens the next column while the earlier context stays visible.\n\nTradeoff: stronger sense of exploration, but returning to one decision requires a stable anchor. The ep0ch river already owns this interaction; do not rebuild it in Tern." },
      { kind: "question", title: "What should remain when the agent leaves?", body: "The result? The reasoning? The alternatives it rejected?\n\nMy bet: a small set of inspectable objects plus the exact questions still open. Compare the two options, then keep, question or park one. Those responses are not approval to deploy anything." },
      { kind: "evidence", title: "Field recording: the map started a conversation", body: "Open the fictional observation log. It deliberately distinguishes authored demonstration content from measured evidence.\n\nA beautiful card is not proof. A source link and a revision are the minimum needed to ask whether the agent's claim follows from what it actually saw.", evidence },
    ] as const;
    for (const item of examples) await room.publish({ ...item, session: "demo-expedition" });
    console.log(JSON.stringify({ status: "initialized", config: configPath, outline: "return-room", room: root.id,
      next: `bun spikes/tern-return-room/demo.ts serve ${JSON.stringify(home)}` }));
  } finally { await host.close(); }
} else {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (resolve(config.outlines) !== outlines) throw new Error("Config does not belong to this private directory.");
  await host.start();
  console.log(JSON.stringify({ status: "ready", config: configPath, socket: host.socketPath }));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await host.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
