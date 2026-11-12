/**
 * The request statuses that say an ask's answer is in (the service's stored rows: an answer applied or proposed, a reply,
 * or nothing to change): a save doesn't ask again (the outliner's agent-requests.ts), and the door's row for an ask
 * answered before its draft opened reads `· answered` over them (PIE-1741). Under way, failed, held or withdrawn are not.
 */
export const ANSWERED_ASK_STATES: ReadonlySet<string> = new Set(["applied", "proposed", "replied", "nothing"]);

/**
 * What an ask on the line the person's cursor is on says while it waits for them (PIE-1743): the service sends it as the
 * ask's warning, and the door's draft reads it to tell the service when the cursor leaves that line again.
 */
export const ASK_AT_CURSOR = "asks once you leave the line or save";
