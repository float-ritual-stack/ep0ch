// A bar source (PIE-656): the `bar` operation answers what the person typed after `~` with rows. A row copies its
// glyph; with a note in front of the person (the call's `context`), one more row runs `rule`, which writes a line of
// the glyph under that note, attributed to ext:glyphs. Nothing here reads the network or anything private.

interface Request {
  operation: string;
  input: { source?: string; query?: string; limit?: number; action?: string; args?: Record<string, string>; target?: { blockId: string }; context?: { block?: { id: string; text: string } } };
}

/** The glyphs, with the names an ANSI artist calls them by and their code page 437 numbers. */
const GLYPHS: { ch: string; name: string; cp: number; words: string }[] = [
  { ch: "░", name: "light shade", cp: 176, words: "shade light dither 25" },
  { ch: "▒", name: "medium shade", cp: 177, words: "shade medium dither 50" },
  { ch: "▓", name: "dark shade", cp: 178, words: "shade dark dither 75" },
  { ch: "█", name: "full block", cp: 219, words: "block full solid" },
  { ch: "▄", name: "lower half block", cp: 220, words: "block half lower bottom" },
  { ch: "▀", name: "upper half block", cp: 223, words: "block half upper top" },
  { ch: "▌", name: "left half block", cp: 221, words: "block half left" },
  { ch: "▐", name: "right half block", cp: 222, words: "block half right" },
  { ch: "■", name: "small square", cp: 254, words: "square bullet" },
  { ch: "─", name: "box line", cp: 196, words: "box line horizontal single" },
  { ch: "═", name: "double box line", cp: 205, words: "box line horizontal double" },
  { ch: "│", name: "box upright", cp: 179, words: "box line vertical single" },
  { ch: "║", name: "double box upright", cp: 186, words: "box line vertical double" },
  { ch: "┌", name: "box corner, top left", cp: 218, words: "box corner top left" },
  { ch: "╔", name: "double corner, top left", cp: 201, words: "box corner top left double" },
  { ch: "·", name: "middle dot", cp: 250, words: "dot middle interpunct" },
];

const say = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const request = (await Bun.stdin.json()) as Request;
const input = request.input;

if (request.operation === "bar") {
  const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const found = GLYPHS.filter(g => words.every(w => g.name.includes(w) || g.words.includes(w) || g.ch === w || String(g.cp) === w));
  const near = input.context?.block;
  const title = near?.text.split("\n", 1)[0]?.replace(/\s*\[[^\]]*::[^\]]*\]/g, "").trim();
  const rows = found.flatMap(g => [
    { id: g.ch, label: `${g.ch}  ${g.name}`, detail: `CP437 ${g.cp} · U+${g.ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`, copy: g.ch,
      preview: `# ${g.ch} ${g.name}\n\n\`${g.ch.repeat(24)}\`\n\nCode page 437 number ${g.cp}. ⏎ copies it.` },
    ...(near && words.length ? [{ id: `rule:${g.ch}`, label: `rule “${title || "this note"}” with ${g.ch}`, detail: "writes a line of it under the note", block: near.id, action: "rule", args: { glyph: g.ch },
      preview: `A line of ${g.name} written under **${title || "this note"}**, attributed to ext:glyphs:\n\n\`${g.ch.repeat(24)}\`` }] : []),
  ]);
  say({ rows: rows.slice(0, input.limit ?? 50) });
} else if (request.operation === "act" && input.action === "rule" && input.target) {
  const glyph = GLYPHS.find(g => g.ch === input.args?.glyph)?.ch ?? "─";
  say({ message: `ruled it with ${glyph}`, writes: [{ op: "create", parentId: input.target.blockId, text: glyph.repeat(32) }] });
} else {
  process.stdout.write(JSON.stringify({ ok: false, code: "not-found" }));
}
