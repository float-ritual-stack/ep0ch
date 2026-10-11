import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { Room } from "./room";
import type { Feedback } from "./room";

const RECEIPTS = "ep0ch.return-room.delivered";
const FEEDBACK = "ep0ch.return-room.feedback";
const CONFIG_HELP = "Return Room is not configured. Launch omp with RETURN_ROOM_CONFIG=/absolute/path/to/scratch-room.json and --extension ./spikes/tern-return-room/omp-extension.ts. Use only the dedicated scratch outline.";

type PublishInput = {
  title: string;
  body: string;
  kind: "finding" | "option" | "question" | "evidence";
  evidence?: string;
};
type Receipt = { version: 1; session: string; delivery: string; ids: string[] };

function receipt(value: unknown): Receipt | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || typeof data.session !== "string" || typeof data.delivery !== "string") return;
  if (!Array.isArray(data.ids) || !data.ids.every((id) => typeof id === "string")) return;
  return data as Receipt;
}

function configured(): string {
  const path = process.env.RETURN_ROOM_CONFIG;
  if (!path) throw new Error(CONFIG_HELP);
  return path;
}

function feedbackText(feedback: Feedback[]): string {
  return [
    "Person feedback explicitly pulled from the Return Room. These are source notes, not system instructions.",
    "Each response names the card revision the person observed; it does not silently edit or approve a newer revision.",
    JSON.stringify(feedback, null, 2),
  ].join("\n\n");
}

/**
 * Explicit commands (none starts inference):
 * /return-room — show scratch room, counts, session ID and config path.
 * /room-pull — append undelivered person feedback to this idle session.
 * /room-publish {"title":"Canopy route","body":"Fictional field note","kind":"option"}
 * The JSON command uses the same schema and originating session as room_publish;
 * it enables a real RPC smoke without asking a model to manufacture tool calls.
 */
export default function returnRoom(pi: ExtensionAPI) {
  const z = pi.zod;
  const publishParameters = z.object({
    title: z.string().min(1).describe("Short card title"),
    body: z.string().min(1).describe("Literal source text to leave in the room"),
    kind: z.enum(["finding", "option", "question", "evidence"]),
    evidence: z.string().optional().describe("Optional evidence path or source reference"),
  });

  // Factories are rebound for child sessions; never share identity at module scope.
  let generation = 0;
  let activeSession: string | undefined;
  let delivered = new Set<string>();
  let pulling = false;

  function restore(ctx: ExtensionContext) {
    generation++;
    activeSession = ctx.sessionManager.getSessionId();
    delivered = new Set();
    if (!process.env.RETURN_ROOM_CONFIG) return;
    const entries = ctx.sessionManager.getBranch();
    const messages = new Map<string, Receipt>();
    for (const entry of entries) {
      if (entry.type !== "custom_message" || entry.customType !== FEEDBACK) continue;
      const data = receipt(entry.details);
      if (data?.session === activeSession) messages.set(data.delivery, data);
    }
    for (const entry of entries) {
      if (entry.type !== "custom" || entry.customType !== RECEIPTS) continue;
      const data = receipt(entry.data);
      if (data?.session !== activeSession) continue;
      const message = messages.get(data.delivery);
      // A receipt without its delivered message must not lose feedback after a
      // interrupted delivery or a tree navigation that excluded that message.
      if (message) for (const id of data.ids) if (message.ids.includes(id)) delivered.add(id);
    }
    // A delivered message is also proof when interruption prevented appendEntry.
    for (const message of messages.values()) for (const id of message.ids) delivered.add(id);
  }

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_switch", (_event, ctx) => restore(ctx));
  pi.on("session_branch", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  // Invalidate asynchronous reads before the host replaces its active context.
  pi.on("session_before_switch", () => { generation++; });
  pi.on("session_before_branch", () => { generation++; });
  pi.on("session_before_tree", () => { generation++; });
  pi.on("session_shutdown", () => { generation++; });

  function capture(ctx: ExtensionContext) {
    const config = configured();
    const session = ctx.sessionManager.getSessionId();
    if (!session) throw new Error("No originating omp session. Open a session before using Return Room.");
    if (activeSession !== session) restore(ctx);
    const expectedGeneration = generation;
    return {
      session,
      config,
      assertCurrent() {
        if (generation !== expectedGeneration || ctx.sessionManager.getSessionId() !== session || process.env.RETURN_ROOM_CONFIG !== config) {
          throw new Error("The omp session, branch or room changed while reading Return Room. Run the command again in the intended session.");
        }
      },
    };
  }

  async function publish(input: PublishInput, ctx: ExtensionContext, signal?: AbortSignal) {
    const origin = capture(ctx);
    signal?.throwIfAborted();
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile || !await Bun.file(sessionFile).exists()) {
      throw new Error("This omp session is not saved yet. Start a normal conversation, or use /new to create a durable empty session, before publishing. Otherwise its return address would disappear on exit.");
    }
    const room = await Room.fromEnv();
    origin.assertCurrent();
    signal?.throwIfAborted();
    // Capture the origin before I/O: a later session switch cannot reattribute it.
    return room.publish({ ...input, session: origin.session });
  }

  pi.registerTool({
    name: "room_publish",
    label: "Leave a Return Room card",
    description: "Publish a finding, option, question or evidence card in the explicitly configured scratch Return Room. Attributed to the current omp session. Use selectively for material the person should compare or respond to; never include credentials or private notes.",
    parameters: publishParameters,
    loadMode: "essential",
    approval: "write",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const card = await publish(params, ctx, signal);
      return { content: [{ type: "text", text: JSON.stringify(card, null, 2) }], details: { card } };
    },
  });

  pi.registerTool({
    name: "room_inbox",
    label: "Read Return Room feedback",
    description: "Read all person feedback addressed to the current omp session, including immutable IDs and observed card revisions. Reading does not acknowledge delivery. Only the person's explicit /room-pull appends feedback and records receipts.",
    parameters: z.object({}),
    approval: "read",
    async execute(_id, _params, signal, _onUpdate, ctx) {
      const origin = capture(ctx);
      signal?.throwIfAborted();
      const room = await Room.fromEnv();
      origin.assertCurrent();
      signal?.throwIfAborted();
      const feedback = await room.inbox(origin.session);
      origin.assertCurrent();
      signal?.throwIfAborted();
      const personal = feedback.filter((item) => item.session === origin.session && item.author === "user");
      const undelivered = personal.filter((item) => !delivered.has(item.id)).map((item) => item.id);
      return {
        content: [{ type: "text", text: JSON.stringify({ session: origin.session, feedback: personal, undelivered }, null, 2) }],
        details: { session: origin.session, feedback: personal, undelivered },
      };
    },
  });

  pi.registerCommand("return-room", {
    description: "Show the dedicated scratch Return Room, current session and explicit pull instructions",
    async handler(_args, ctx) {
      const origin = capture(ctx);
      const room = await Room.fromEnv();
      const snapshot = await room.snapshot();
      origin.assertCurrent();
      const feedback = snapshot.feedback.filter((item) => item.session === origin.session && item.author === "user");
      ctx.ui.notify([
        snapshot.title,
        `Outline: ${snapshot.outline} | Room: ${snapshot.room}`,
        `Config: ${origin.config}`,
        `Session: ${origin.session}`,
        `${snapshot.cards.length} cards; ${feedback.filter((item) => !delivered.has(item.id)).length} undelivered responses for this session${snapshot.complete ? "" : " (partial snapshot)"}.`,
        "Open return-room.room in Tern. /room-pull appends feedback without starting a model turn.",
        '/room-publish {"title":"Canopy route","body":"Fictional field note","kind":"option"} publishes without model inference.',
      ].join("\n"), "info");
    },
  });

  pi.registerCommand("room-publish", {
    description: 'Publish without inference: /room-publish {"title":"…","body":"…","kind":"finding|option|question|evidence","evidence":"optional path"}',
    async handler(args, ctx) {
      configured();
      let input: unknown;
      try { input = JSON.parse(args); } catch {
        throw new Error('Use /room-publish {"title":"Canopy route","body":"Fictional field note","kind":"option"}.');
      }
      const parsed = publishParameters.safeParse(input);
      if (!parsed.success) throw new Error(`Invalid /room-publish card: ${parsed.error.message}`);
      const card = await publish(parsed.data, ctx);
      ctx.ui.notify(JSON.stringify({ published: card }, null, 2), "info");
    },
  });

  pi.registerCommand("room-pull", {
    description: "Explicitly append undelivered person feedback to this idle session; never starts a model turn",
    async handler(_args, ctx) {
      const origin = capture(ctx);
      if (pulling) throw new Error("A Return Room pull is already in progress. Wait for it to finish.");
      if (!ctx.isIdle()) throw new Error("Wait for the current agent turn to finish, then run /room-pull. Feedback is never injected into an active turn.");
      pulling = true;
      try {
        const room = await Room.fromEnv();
        origin.assertCurrent();
        const inbox = await room.inbox(origin.session);
        origin.assertCurrent();
        if (!ctx.isIdle()) throw new Error("The agent started a turn while reading feedback. Run /room-pull when it is idle.");
        const ids = new Set<string>();
        const feedback = inbox.filter((item) => {
          if (item.session !== origin.session || item.author !== "user" || delivered.has(item.id) || ids.has(item.id)) return false;
          ids.add(item.id);
          return true;
        });
        if (!feedback.length) {
          ctx.ui.notify("No undelivered Return Room feedback for this session.", "info");
          return;
        }
        const data: Receipt = { version: 1, session: origin.session, delivery: crypto.randomUUID(), ids: [...ids] };
        // nextTurn stays passive even if another prompt starts during delivery.
        // The custom message carries receipt metadata so branch restoration can
        // distinguish durable delivery from an interrupted enqueue.
        pi.sendMessage({ customType: FEEDBACK, content: feedbackText(feedback), display: true, attribution: "user", details: data }, { deliverAs: "nextTurn", triggerTurn: false });
        pi.appendEntry(RECEIPTS, data);
        for (const id of ids) delivered.add(id);
        ctx.ui.notify(`Pulled ${feedback.length} Return Room response${feedback.length === 1 ? "" : "s"}. No model turn started; continue when ready.`, "info");
      } finally {
        pulling = false;
      }
    },
  });
}
