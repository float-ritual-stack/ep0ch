// How long a ranked search may take, and how long its caller waits for it (PIE-1810). A search with Jev (`tree.search`
// with `semantic`, and `deep` above all) is the one read that asks another service, up to three times: the ranking, the
// deep pass over every note, and the ranking again with what that found. The service holds the whole of it to one
// budget and answers with what it has when the budget is spent (the text matches, or the ranked ones without the deep
// pass), saying what was skipped; a client asking for it waits that long and a margin, never a keypress's 3 s. Both
// numbers are here so neither side restates the other's.

/** The service's deadline for one search, every Jev request in it included. */
export const SEARCH_BUDGET_MS = 20_000;
/** What a client waits for a search with Jev: the budget, plus reading the answer's rows and a busy host's turn. */
export const SEARCH_WAIT_MS = SEARCH_BUDGET_MS + 5_000;
