import { STRIKETHROUGH_DELIMITER } from "@ep0ch/outline-core/inline-grammar";
import type { MarkedExtension } from "marked";

/** Keep Marked's inline parsing, but use Blockdown's strike delimiter. */
export const blockdownMarked: MarkedExtension = {
  tokenizer: {
    del(source) {
      return source.startsWith(STRIKETHROUGH_DELIMITER) ? false : undefined;
    },
  },
};
