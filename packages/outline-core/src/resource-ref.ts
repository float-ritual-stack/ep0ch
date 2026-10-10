// A Resource ref (PIE-754): how an extension names a Resource it wants opened, where it would name a block id. A bar
// row's `resource`, a table's `links` or a card's `link`, and an action's `open` answer all take one:
//
//   file:/absolute/path     a file on the service's machine (registered as a file Resource when it isn't yet)
//   web:https://…           a web page
//   resource:<id>           a Resource already registered
//
// It names the same three things a note's `[file::…]` and `[web::…]` tokens do, and opens the way a Resource row of
// the links tile does: registered first when it must be, then its stored text shown as a note. Pure: no I/O.

export type ResourceRefTarget =
  | { readonly kind: "filesystem"; readonly path: string }
  | { readonly kind: "web"; readonly url: string }
  | { readonly kind: "resource"; readonly resourceId: string };

const MAX = 4_096;

/** Whether a string is written as a Resource ref (it may still be a bad one: `parseResourceRef` says why). */
export const isResourceRef = (value: string): boolean => /^(file|web|resource):/.test(value);

/** What a Resource ref names, or why it can't be used. */
export function parseResourceRef(value: string): ResourceRefTarget | { readonly problem: string } {
  if (value.length > MAX) return { problem: `a Resource ref is at most ${MAX} characters` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { problem: "a Resource ref has no control characters" };
  if (value.startsWith("file:")) {
    const path = value.slice(5);
    if (!path.startsWith("/")) return { problem: `file: takes an absolute path (file:/home/you/notes.md), not ${path || "nothing"}` };
    return { kind: "filesystem", path };
  }
  if (value.startsWith("web:")) {
    const url = value.slice(4);
    if (!/^https?:\/\/[^\s]+$/.test(url)) return { problem: `web: takes an http or https URL, not ${url || "nothing"}` };
    return { kind: "web", url };
  }
  if (value.startsWith("resource:")) {
    const resourceId = value.slice(9);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(resourceId)) return { problem: `resource: takes a Resource id, not ${resourceId || "nothing"}` };
    return { kind: "resource", resourceId };
  }
  return { problem: `a Resource ref starts with file:, web: or resource:, not ${value.slice(0, 40)}` };
}
