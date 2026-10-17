// Kind 3, rich component (PIE-827): pictures in a view. `gallery::` on a block draws the notes under it as a row of
// cards, each with the picture its `[cover::path]` names as its cover; `pic:: path` draws one picture. Both use the
// shared `image` primitive, so each reader draws it the way it draws a note's `[img::]` line: the door's graphics,
// dimmed dark-first; a page's served image, when the publish roots allow the file; elsewhere its words and its file.
// Nothing is written to the outline: the pictures are the view's.

/** A block as the service sends it in `context`: outline-core's record (properties as `{ key, values }`, a spot in the text as a field). */
interface Record_ { id: string; text: string; title: string; properties: { key: string; values: string[] }[]; fields: { key: string; value: string }[] }
interface Request {
  operation: string;
  input: { handler?: string; argument?: string | null; context: { block: Record_; children: Record_[] } };
}

/** A card narrower than this many characters reads badly: the row stacks instead. */
const MIN_CARD = 22;
const MAX_CARDS = 4;
const request = (await Bun.stdin.json()) as Request;
const { argument, context } = request.input;
const handler = request.input.handler ?? "gallery";

const plain = (title: string) => title.replace(/^#+\s*/, "").trim();
/** A property of a note wherever it is written (a header chip, a line of its own, mid-sentence): the record's, never a scan of its text. */
const valueOf = (note: Record_, key: string) => (note.properties.find((p) => p.key === key)?.values[0] ?? note.fields.find((f) => f.key === key)?.value)?.trim();

function answer(value: unknown) {
  process.stdout.write(JSON.stringify({ ok: true, value }));
}

if (handler === "pic") {
  const src = (argument ?? "").trim();
  const alt = context.block.text.trim() ? plain(context.block.title) : "";
  answer({ title: "a picture", data: { src }, view: { type: "image", src, ...(alt ? { alt } : {}), size: "60%" } });
} else {
  const rows = Number(argument ?? 0) || 6;
  const cards = context.children.filter((child) => child.text.trim()).slice(0, MAX_CARDS).map((child) => {
    const rest = child.text.split("\n").slice(1);
    const cover = valueOf(child, "cover");
    // The first line of words under the title: not the one that only carries the cover.
    const words = rest.map((l) => l.trim()).find((l) => l && !/^\[cover::/.test(l));
    return { id: child.id, title: plain(child.title) || "untitled", cover, words: words ? words.replace(/\s*\[[\w.-]+::[^\]]*\]/g, "").trim() : undefined };
  });
  const view = cards.length ? {
    type: "row", minWidth: MIN_CARD,
    children: cards.map((card) => ({
      type: "card", title: card.title, link: card.id,
      children: [
        ...(card.cover ? [{ type: "image", src: card.cover, alt: card.title, height: rows, fit: "cover", caption: false }] : [{ type: "text", text: "no [cover::] picture", tone: "dim" }]),
        ...(card.words ? [{ type: "text", text: card.words, tone: "dim" }] : []),
      ],
    })),
  } : { type: "text", text: "gallery: no notes under this line yet", tone: "dim" };
  answer({ title: `${cards.length} cards`, data: { cards }, view });
}
