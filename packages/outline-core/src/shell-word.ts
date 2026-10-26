// A word for a POSIX shell: what a command printed for a person to run (a hint, `ep0ch find …` under a copied figure,
// a program a tile starts) quotes its arguments with this, so it runs as shown. Pure.

/** `s` as one shell word: as written when it needs no quoting, else in single quotes. */
export const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
