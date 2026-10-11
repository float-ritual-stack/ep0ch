import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { headerLine, joinHeaderLine } from "../../packages/outline-core/src/header-line";
import { isWritablePropertyValue } from "../../packages/outline-core/src/property-grammar";
import type { Block } from "../../packages/outline-core/src/protocol";

export interface RoomConfig { version: 1; outlines: string; outline: string; room: string; drafts: string }
export interface Card {
  id: string; revision: number; title: string; body: string; kind: string; session: string;
  evidence: string; author: string; updated: string;
}
export interface Feedback {
  id: string; card: string; revision: number; verdict: string; text: string;
  session: string; author: string; updated: string;
}
export interface Snapshot { title: string; outline: string; room: string; cards: Card[]; feedback: Feedback[]; complete: boolean }
const ROOT = resolve(import.meta.dir, "../..");
const CLI = join(ROOT, "packages/outliner/src/cli.ts");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["finding", "option", "question", "evidence"];
const VERDICTS = ["keep", "question", "park", "reply"];

export function isolatedEnv(outlines: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(EP0CH_|OUTLINER_|HERDR_)/.test(key)) env[key] = value;
  }
  return { ...env, EP0CH_OUTLINES: outlines, XDG_CONFIG_HOME: join(outlines, "../config"), EP0CH_DAEMON: "0" };
}

export async function outlineCommand(outlines: string, outline: string, args: string[]): Promise<any> {
  const child = Bun.spawn([process.execPath, CLI, "--ws", outline, ...args], {
    cwd: ROOT, env: isolatedEnv(outlines), stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  const timer = setTimeout(() => child.kill(), 15_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`Outline command refused: ${stderr.trim() || `exit ${code}`}. Check the scratch host for ${outlines}.`);
    return JSON.parse(stdout);
  } finally { clearTimeout(timer); }
}

function prop(block: Block, key: string): string {
  return block.properties.find(p => p.key === key)?.value ?? "";
}
function cardOf(block: Block): Card {
  return { id: block.id, revision: block.revision, title: headerLine(block.text).prose,
    body: block.text.slice(headerLine(block.text).end + 1).replace(/^\n/, ""), kind: prop(block, "return-kind"), session: prop(block, "return-session"),
    evidence: prop(block, "return-evidence"), author: block.author, updated: block.updatedAt };
}
function feedbackOf(block: Block): Feedback {
  return { id: block.id, card: prop(block, "return-target"), revision: Number(prop(block, "return-revision")),
    verdict: prop(block, "return-verdict"), text: block.text.slice(headerLine(block.text).end + 1).replace(/^\n/, ""), session: prop(block, "return-session"),
    author: block.author, updated: block.updatedAt };
}
function note(title: string, properties: Record<string, string>, text: string): string {
  if (!title.trim() || /[\r\n]/.test(title) || headerLine(title).chips.length) {
    throw new Error("Use a nonempty, single-line plain title without header properties; put source text in the body.");
  }
  const chips = Object.entries(properties).map(([key, value]) => {
    if (!isWritablePropertyValue(value)) throw new Error(`Cannot encode ${key} as an outline property.`);
    return { key, value };
  });
  return `${joinHeaderLine(title, chips)}\n\n${text}`;
}

/** Both clients cross this seam; the outline host owns every canonical card and response. */
export class Room {
  private constructor(readonly config: RoomConfig) {}

  static async fromEnv(): Promise<Room> {
    const path = process.env.RETURN_ROOM_CONFIG;
    if (!path || !isAbsolute(path)) throw new Error("Set RETURN_ROOM_CONFIG to the absolute room.json path printed by bun spikes/tern-return-room/demo.ts init <private-directory>.");
    const config = JSON.parse(await readFile(path, "utf8")) as RoomConfig;
    if (config.version !== 1 || !isAbsolute(config.outlines ?? "") || !isAbsolute(config.drafts ?? "") ||
      !/^[a-z][a-z0-9-]*$/.test(config.outline ?? "") || !UUID.test(config.room ?? "")) {
      throw new Error("Invalid Return Room config: require version 1, absolute outlines/drafts, an outline name and root UUID.");
    }
    const folder = await realpath(config.outlines);
    const homeOutlines = await realpath(join(homedir(), "outlines")).catch(() => join(homedir(), "outlines"));
    if (folder === homeOutlines) throw new Error("Return Room is a spike: refusing the real outlines folder. Initialize a private room instead.");
    return new Room({ ...config, outlines: folder });
  }

  private run(args: string[]): Promise<any> { return outlineCommand(this.config.outlines, this.config.outline, args); }

  private async root(): Promise<{ title: string }> {
    const root = await this.run(["agent", "read", "--json", JSON.stringify({ ref: this.config.room, depth: 0 })]);
    if (root.properties?.["return-kind"] !== "room") throw new Error("Configured root is not a Return Room. Re-run demo init in a new private directory.");
    return root;
  }

  async snapshot(): Promise<Snapshot> {
    const root = await this.root();
    const result = await this.run(["list", "--subtree", this.config.room, "--limit", "500"]);
    const blocks: Block[] = result.blocks;
    if (!Array.isArray(blocks)) throw new Error("Outline host returned no block collection.");
    const cards = blocks.filter(b => b.parentId === this.config.room && KINDS.includes(prop(b, "return-kind"))).map(cardOf);
    const ids = new Set(cards.map(c => c.id));
    const feedback = blocks.filter(b => prop(b, "return-kind") === "feedback" && ids.has(b.parentId ?? "") &&
      prop(b, "return-target") === b.parentId).map(feedbackOf).sort((a, b) => a.updated.localeCompare(b.updated) || a.id.localeCompare(b.id));
    return { title: root.title, outline: this.config.outline, room: this.config.room, cards, feedback,
      complete: result.completeness?.kind === "complete" };
  }

  private async card(id: string): Promise<Card> {
    if (!UUID.test(id)) throw new Error("Card must be a block UUID from this room.");
    await this.root();
    const result = await this.run(["list", "--subtree", id, "--limit", "1"]);
    const block: Block | undefined = result.blocks?.find((b: Block) => b.id === id);
    if (!block || block.parentId !== this.config.room || !KINDS.includes(prop(block, "return-kind"))) {
      throw new Error("That card is not a direct child of this Return Room; refresh and select a current card.");
    }
    return cardOf(block);
  }

  async publish(input: { title: string; body: string; kind: "finding" | "option" | "question" | "evidence"; session: string; evidence?: string }): Promise<Card> {
    await this.root();
    if (!KINDS.includes(input.kind) || typeof input.body !== "string" || !input.body.trim()) throw new Error("Publish a finding, option, question or evidence card with a nonempty body.");
    if (!input.session?.trim()) throw new Error("Publishing requires the originating omp session id.");
    const text = note(input.title, { "return-kind": input.kind, "return-session": input.session,
      ...(input.evidence ? { "return-evidence": input.evidence } : {}) }, input.body);
    const result: Block = await this.run(["create", "--parent", this.config.room, "--text", text,
      "--author", "agent", "--actor", "return-room:omp", "--session", input.session]);
    return cardOf(result);
  }

  async respond(input: { card: string; revision: number; verdict: "keep" | "question" | "park" | "reply"; text?: string }): Promise<Feedback> {
    const card = await this.card(input.card);
    if (!Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > card.revision) throw new Error("Feedback must name an observed revision of this card; refresh first.");
    if (!VERDICTS.includes(input.verdict)) throw new Error("Choose keep, question, park or reply.");
    if (input.verdict === "reply" && !input.text?.trim()) throw new Error("The saved reply is empty. Write and save it in Tern's file editor, then Send saved reply.");
    const text = note(`${input.verdict} — ${card.title}`, { "return-kind": "feedback", "return-target": card.id,
      "return-revision": String(input.revision), "return-verdict": input.verdict, "return-session": card.session }, input.text ?? "");
    const result: Block = await this.run(["create", "--parent", card.id, "--text", text, "--author", "user"]);
    return feedbackOf(result);
  }

  async inbox(session: string): Promise<Feedback[]> {
    const snapshot = await this.snapshot();
    if (!snapshot.complete) throw new Error("Room exceeds the 500-note snapshot limit; feedback may be missing. Split the room before pulling feedback.");
    return snapshot.feedback.filter(f => f.session === session);
  }

  async draft(card: string): Promise<{ path: string; revision: number }> {
    const source = await this.card(card);
    await mkdir(this.config.drafts, { recursive: true, mode: 0o700 });
    const path = join(this.config.drafts, `${card}.txt`);
    const anchor = join(this.config.drafts, `${card}.anchor.json`);
    if (!await Bun.file(anchor).exists()) {
      if (await Bun.file(path).exists()) throw new Error(`Existing draft has no revision anchor: ${path}. Preserve it and establish its original source revision before sending.`);
      try { await writeFile(anchor, JSON.stringify({ revision: source.revision }), { flag: "wx", mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const { revision } = JSON.parse(await readFile(anchor, "utf8"));
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > source.revision) throw new Error(`Invalid draft revision anchor: ${anchor}. Preserve the draft and repair its anchor before sending.`);
    try { await writeFile(path, "", { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return { path, revision };
  }

  async sendDraft(card: string, revision: number): Promise<Feedback> {
    const { path, revision: anchored } = await this.draft(card);
    if (anchored !== revision) throw new Error(`This draft is anchored to revision ${anchored}, not ${revision}. Reopen the reply to restore its original anchor.`);
    const text = await readFile(path, "utf8");
    // Capture is append-only. Never clear a file that a person may still be editing.
    return this.respond({ card, revision, verdict: "reply", text });
  }
}
