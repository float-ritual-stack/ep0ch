// A rule that decorates (PIE-600): the service matches every block with [type::meeting] and asks this program,
// once per revision of the block, for the view drawn above it. It reads only what the call hands it (the block's
// properties and children) and returns primitives every client draws: no client code, and the note's text is never
// changed. All meetings are made up.

interface Property { key: string; value: string }
interface Request {
  operation: "decorate";
  input: {
    rule: string;
    hit: { at: "block" | "construct" | "text"; line: number; text: string };
    context: { block: { id: string; text: string; properties: Property[] }; children: { id: string; text: string }[] };
  };
}

const request = (await Bun.stdin.json()) as Request;
const { block, children } = request.input.context;
const values = (key: string) => block.properties.filter((p) => p.key === key).flatMap((p) => p.value.split(",")).map((v) => v.trim()).filter(Boolean);
const title = block.text.split("\n", 1)[0]!.replace(/\[[^\]\n]*::[^\]\n]*\]/g, "").trim();
const who = values("attendees");
const when = values("when")[0] ?? "no time set";
const where = values("where")[0];
const actions = children.filter((child) => /^\s*-\s*\[ \]/m.test(child.text)).length;

process.stdout.write(JSON.stringify({ ok: true, value: {
  title: `Meeting · ${title}`,
  view: {
    type: "card",
    title,
    subtitle: [when, where].filter(Boolean).join(" · "),
    badge: { label: "meeting", tone: "accent" },
    children: [{
      type: "row",
      children: [
        { type: "stat", label: "Who", value: who.length ? who.join(", ") : "nobody yet" },
        { type: "stat", label: "Notes", value: children.length, ...(actions ? { unit: `· ${actions} open` } : {}) },
      ],
    }],
  },
} }));
