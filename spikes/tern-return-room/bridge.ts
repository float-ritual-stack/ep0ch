import { Room } from "./room";

const args = process.argv.slice(2);
if (args[0] === "--config") {
  process.env.RETURN_ROOM_CONFIG = args[1];
  args.splice(0, 2);
}
try {
  const room = await Room.fromEnv();
  const input = JSON.parse(args[1] ?? "{}");
  let result: unknown;
  switch (args[0]) {
    case "snapshot": result = await room.snapshot(); break;
    case "publish": result = await room.publish(input); break;
    case "respond": result = await room.respond(input); break;
    case "draft": result = await room.draft(input.card); break;
    case "send-draft": result = await room.sendDraft(input.card, input.revision); break;
    case "inbox": result = await room.inbox(input.session); break;
    default: throw new Error("Use snapshot, publish, respond, draft, send-draft or inbox with one JSON argument.");
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
