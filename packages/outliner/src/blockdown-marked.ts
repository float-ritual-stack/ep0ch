import { STRIKETHROUGH_DELIMITER } from "@ep0ch/outline-core/inline-grammar";
import { Tokenizer, type MarkedExtension } from "marked";
import { COMPONENT_OPEN, componentBlockAt } from "@ep0ch/outline-core/component-block";
import { parseStyleAttrs, resolveStyle } from "@ep0ch/outline-core/style-cascade";

export const boxExtension: NonNullable<MarkedExtension["extensions"]>[number] = {
  name: "noteBox", level: "block",
  start: source => source.match(/^ {0,3}::box\{/m)?.index,
  tokenizer(source) {
    const block = componentBlockAt(source);
    if (block?.name !== "box") return;
    const start = block.raw.indexOf("\n") + 1;
    const end = block.raw.trimEnd().lastIndexOf("\n");
    const attrs = COMPONENT_OPEN.exec(block.raw.slice(0, start - 1))?.[3]?.slice(1, -1) ?? "";
    return { type: "noteBox", raw: block.raw, attrs, bodyStart: start, bodyEnd: end, tokens: this.lexer.blockTokens(block.raw.slice(start, end)) };
  },
  renderer(token) {
    const v = resolveStyle([{ level: "block", label: "box", fields: { "margin.x": "0", ...parseStyleAttrs(token.attrs).fields } }], 80).values;
    const framed = v.border !== "auto" && v.border !== "none" || v.edge === "box";
    const style = `margin:${v["margin.y"]}em ${v["margin.x"]}ch;padding:${v["pad.y"]}em ${v["pad.x"]}ch;` +
      (framed ? `border:1px solid var(--rule);${v.border === "round" ? "border-radius:.5rem;" : ""}` : "") +
      (v.edge === "bar" ? "border-left:3px solid var(--link);" : "") +
      (v.bg !== "none" ? "background:color-mix(in srgb,var(--link) 8%,var(--bg));" : "");
    return `<section class="note-box" style="${style}">${this.parser.parse(token.tokens!)}</section>\n`;
  },
};

/** Keep Marked's inline parsing, but use Blockdown's strike delimiter. */
export const blockdownMarked: MarkedExtension = {
  extensions: [boxExtension],
  tokenizer: {
    lheading(source) {
      // Marked tries setext headings before the paragraph's extension boundary.
      const box = /^ {0,3}::box\{/m.exec(source);
      if (!box?.index || !componentBlockAt(source.slice(box.index))) return undefined;
      const heading = Tokenizer.prototype.lheading.call(this, source);
      if (!heading || heading.raw.length <= box.index) return undefined;
      const raw = source.slice(0, box.index), text = raw.trimEnd();
      return { type: "paragraph", raw, text, tokens: this.lexer.inline(text) } as unknown as false;
    },
    del(source) {
      return source.startsWith(STRIKETHROUGH_DELIMITER) ? false : undefined;
    },
  },
};
