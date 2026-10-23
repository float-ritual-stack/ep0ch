import { mcpCommand } from "./mcp";

interface Request { line: string; call: string; adopted: string[] }
let receive: ((request: Request | null) => void) | undefined;
const queued: (Request | null)[] = [];
process.on("message", (message: Request | { end: true }) => {
  const value = "end" in message ? null : message;
  if (receive) { const ready = receive; receive = undefined; ready(value); }
  else queued.push(value);
});
async function* input(): AsyncIterable<string> {
  for (;;) {
    const request = queued.length ? queued.shift()! : await new Promise<Request | null>(r => { receive = r; });
    if (!request) return;
    call = request.call;
    adopted = request.adopted;
    yield request.line;
    process.send!({ done: true });
  }
}
let call = "";
let adopted: string[] = [];
const code = await mcpCommand(process.argv.slice(2), {
  input: input(), write: line => process.send!({ line }), call: () => call,
  adopted: () => adopted,
  onAdopt: adopt => process.send!({ adopt }), onRelease: release => process.send!({ release }),
});
process.disconnect!();
process.exit(code);
