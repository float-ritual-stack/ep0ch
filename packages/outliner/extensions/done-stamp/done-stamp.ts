// A rule that runs (PIE-600): when a block starts matching the done keys its manifest names, the service runs `stamp`
// on it; when it stops, `unstamp`. The write is the extension's (ext:done-stamp), with the person or agent whose save set it off
// recorded beside it, and a save an extension makes never sets a rule off again, so stamping can't loop.

interface Request {
  operation: "act";
  input: {
    action: "stamp" | "unstamp";
    target: { blockId: string; revision: number };
    context: { block: { text: string; properties: { key: string }[] }; now: string };
  };
}

const request = (await Bun.stdin.json()) as Request;
const { action, target, context } = request.input;
const text = context.block.text;
const [first = "", ...rest] = text.split("\n");
const STAMP = /[ \t]*\[done-at::[^\]\n]*\]/g;
const answer = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
// The day on this machine's clock, as a ticket's done-at (work-stage-follows.ts) and `due=today` read it.
const dayOf = (now: string) => { const d = new Date(now), pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

if (action === "stamp") {
  // Any block property counts: the store writes a ticket's done-at, on the line under a one-line title.
  if (context.block.properties.some(property => property.key === "done-at")) answer({ message: "already stamped" });
  else {
    const day = dayOf(context.now);
    answer({ message: `stamped done-at ${day}`, writes: [{ op: "update", blockId: target.blockId, expectedRevision: target.revision,
      text: [`${first.trimEnd()} [done-at::${day}]`, ...rest].join("\n") }] });
  }
} else {
  const unstamped = first.replace(STAMP, "");
  if (unstamped === first) answer({ message: "no stamp to take off" });
  else answer({ message: "took the done stamp off", writes: [{ op: "update", blockId: target.blockId, expectedRevision: target.revision, text: [unstamped, ...rest].join("\n") }] });
}
