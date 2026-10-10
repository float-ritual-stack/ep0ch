// A scheduled program (PIE-754): its `write-day` action runs every morning at 06:05 (the host's time), acts on the
// outline as a whole (`on: "outline"`, no block), and writes a dated note somewhere else: under the page its config
// names (`almanac` by default), in the outline it runs for or another one on the host. It writes over its own
// connection (outline.ts), so the note is ext:almanac's. Every saying is made up.
import { outline } from "./outline";

interface Block { id: string; text: string; revision: number }
interface Request {
  operation: "act";
  input: { action: "write-day"; context: { now: string }; scheduled?: { at: string } };
  config: { page?: string; outline?: string };
}

const SAYINGS = [
  "The kettle remembers every morning it was filled.",
  "Moss keeps its own calendar and never shares it.",
  "A ladder left out overnight counts the stars twice.",
  "Odd socks gather on the third day after a full moon.",
  "The shed door creaks louder on days with mail.",
  "Bread rises faster when nobody watches it.",
  "Herons stand still on purpose, and so may you.",
];

const answer = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const { input, config } = (await Bun.stdin.json()) as Request;
const day = input.context.now.slice(0, 10);
const page = config.page ?? "almanac";
const where = config.outline;

const home = await outline<{ status: string; block?: Block }>({ action: "pages.resolve", address: page }, where);
if (home.status !== "resolved" || !home.block) {
  answer({ message: `no [[${page}]] page${where ? ` in ${where}` : ""}: write [page::${page}] on the note it should write under` });
} else {
  const title = `Almanac for ${day}`;
  const children = await outline<Block[]>({ action: "children", parentId: home.block.id }, where);
  if (children.some((child) => child.text.startsWith(title))) {
    answer({ message: `${title} is already there` });
  } else {
    const saying = SAYINGS[Number(day.replaceAll("-", "")) % SAYINGS.length]!;
    const note = await outline<Block>({ action: "create", parentId: home.block.id, text: `${title} [type::almanac] [date::${day}]\n\n${saying}` }, where);
    answer({ message: `wrote ${title}${where ? ` in ${where}` : ""}${input.scheduled ? " (scheduled)" : ""}` });
  }
}
