// Reading a copied page back (PIE-1355): its Markdown parsed by a Markdown parser (marked's lexer), and the tokens from
// one figure's results heading on, so a test checks what a reader of the paste gets, not the characters.
import { marked, type Token, type Tokens } from "marked";

export type { Tokens };

/** The page's top-level tokens. */
export const lex = (markdown: string): Token[] => marked.lexer(markdown);

/** The tokens from the results heading of the figure titled `title` on, or null when it has none. */
export function resultsOf(tokens: Token[], title: string): Token[] | null {
  const at = tokens.findIndex(t => t.type === "paragraph" && (t as Tokens.Paragraph).text.startsWith(`**Results · ${title}**`));
  return at < 0 ? null : tokens.slice(at);
}

/** The first token of `type` in `tokens`. */
export const first = <T extends Token>(tokens: Token[], type: string): T => tokens.find(t => t.type === type) as T;

/** Every paragraph's text in `tokens`. */
export const paragraphs = (tokens: Token[]): string[] => tokens.flatMap(t => (t.type === "paragraph" ? [(t as Tokens.Paragraph).text] : []));
