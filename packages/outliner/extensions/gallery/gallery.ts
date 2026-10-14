// Kind 3, rich component (PIE-827): pictures in a view. `gallery::` on a block draws the notes under it as a row of
// cards, each with the picture its `[cover::path]` names as its cover; `pic:: path` draws one picture. Both use the
// shared `image` primitive, so each reader draws it the way it draws a note's `[img::]` line: the door's graphics,
// dimmed dark-first; a page's served image, when the publish roots allow the file; elsewhere its words and its file.
// Nothing is written to the outline: the pictures are the view's.

interface Child { id: string; text: string }
interface Request {
  operation: string;
  input: { handler?: string; argument?: string | null; context: { block: { text: string }; children: Child[] } };
}

/** A card narrower than this many characters reads badly: the row stacks instead. */
const MIN_CARD = 22;
const MAX_CARDS = 4;
const request = (await Bun.stdin.json()) as Request;
const { argument, context } = request.input;
const handler = request.input.handler ?? "gallery";

const plain = (text: string) => text.replace(/\s*\[[\w.-]+::[^\]]*\]/g, "").replace(/^#+\s*/, "").trim();

function answer(value: unknown) {
  process.stdout.write(JSON.stringify({ ok: true, value }));
}

if (handler === "pic") {
  const src = (argument ?? "").trim();
  const alt = plain(context.block.text.split("\n")[0] ?? "");
  answer({ title: "a picture", data: { src }, view: { type: "image", src, ...(alt ? { alt } : {}), size: "60%" } });
} else {
  const rows = Number(argument ?? 0) || 6;
  const cards = context.children.filter((child) => child.text.trim()).slice(0, MAX_CARDS).map((child) => {
    const [first = "", ...rest] = child.text.split("\n");
    const cover = /\[cover::([^\]]+)\]/.exec(child.text)?.[1]?.trim();
    const words = rest.map((l) => l.trim()).find((l) => l && !/^\[cover::/.test(l));
    return { id: child.id, title: plain(first) || "untitled", cover, words: words ? plain(words) : undefined };
  });
  const view = cards.length ? {
    type: "row", minWidth: MIN_CARD,
    children: cards.map((card) => ({
      type: "card", title: card.title, link: card.id,
      children: [
        ...(card.cover ? [{ type: "image", src: card.cover, alt: card.title, height: rows, fit: "cover" }] : [{ type: "text", text: "no [cover::] picture", tone: "dim" }]),
        ...(card.words ? [{ type: "text", text: card.words, tone: "dim" }] : []),
      ],
    })),
  } : { type: "text", text: "gallery: no notes under this line yet", tone: "dim" };
  answer({ title: `${cards.length} cards`, data: { cards }, view });
}
