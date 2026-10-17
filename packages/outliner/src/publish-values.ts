// The `{{ }}` of a published page (PIE-533 S2): the page's text carries the value the service's `site.answer` reads, never the
// placeholder, and never a value read through a note the page may not show. The service resolves; this asks it for each
// note of the page that holds a placeholder, then asks again, naming the notes the page may not show (`hidden`), when the
// first answer was computed from any of them. A value that read one is left out whole: `hidden here`, naming nothing. The
// same rule figure rows follow (publish-live.ts): a row the page may not show is left out, never named.
import { interpolationSpans } from "@ep0ch/outline-core/interpolation";
import type { SiteAnswer, SiteValue } from "@ep0ch/outline-core/site";
import { MAX_NOTE_VALUES, markdownValueWords } from "@ep0ch/outline-core/site-values";
import type { LiveHost } from "./publish-live";

/** The most notes of one page whose placeholders are read (the rest stay as typed). */
export const MAX_PAGE_VALUE_NOTES = 200;
/** The most times one note's answer is asked again as notes the page may not show turn up in it. */
const MAX_ROUNDS = 4;

/** The values of each note in `blocks` that holds a placeholder, as the page may show them (by note id). */
export async function readPageValues(host: LiveHost, blocks: readonly { id: string; text: string }[]): Promise<Map<string, readonly SiteValue[]>> {
  const out = new Map<string, readonly SiteValue[]>();
  const wanted = blocks.filter(block => block.text.includes("{{") && interpolationSpans(block.text).length > 0).slice(0, MAX_PAGE_VALUE_NOTES);
  for (const block of wanted) {
    try {
      // Each answer may be computed from notes the one before did not read (a fallback once an ancestor is left out): asked
      // again, naming every note found not shown, until it reads only notes the page shows. A read that never settles says nothing.
      const hidden = new Set<string>();
      let answer: SiteAnswer | undefined;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        answer = await host.request<SiteAnswer>({ action: "site.answer", blockId: block.id, ...(hidden.size ? { hidden: [...hidden] } : {}) });
        const touched = new Set<string>(answer.deps);
        for (const v of answer.values) {
          if (v.from) touched.add(v.from);
          for (const l of v.links ?? []) touched.add(l.id);
        }
        touched.delete(block.id);
        const shown = touched.size ? await host.shown([...touched]) : new Set<string>();
        const fresh = [...touched].filter(id => !shown.has(id) && !hidden.has(id));
        if (!fresh.length) break;
        for (const id of fresh) hidden.add(id);
        if (round === MAX_ROUNDS - 1) answer = undefined;
      }
      if (answer) out.set(block.id, answer.values.slice(0, MAX_NOTE_VALUES));
    } catch {
      // A service that can't answer (an older one, a note gone): the placeholders stay as typed.
    }
  }
  return out;
}

/** A value's words as Markdown text (outline-core's `markdownValueWords`: literal, a lone web address a link). */
export const publishedValueWords = markdownValueWords;
