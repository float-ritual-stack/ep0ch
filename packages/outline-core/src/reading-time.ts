// How long something said to a person stays up: the one rule every client has (the door's status bar, PIE-1729; the
// native window's status line and its notice). A moment to look, then about 14 columns a second, at most 30 s; and
// never less than the time its sayer asks, 4 s when it asks none. What counts a text's columns is each client's own
// (the door's cells, a window's characters). `fixtures/core-contract.json` (`stays`) holds a port to these numbers.

/** How long a message stays when its sayer names no time. */
export const MESSAGE_MS = 4000;

/** How long `columns` of text take to read: a moment to look, then about 14 columns a second, at most 30 s. */
export function readingMs(columns: number): number {
  return Math.min(30_000, 1500 + Math.max(0, columns) * 70);
}

/** How long a message of `columns` stays up: the time asked for it, and never gone before it can be read. */
export function staysMs(columns: number, asked: number = MESSAGE_MS): number {
  return Math.max(asked, readingMs(columns));
}
