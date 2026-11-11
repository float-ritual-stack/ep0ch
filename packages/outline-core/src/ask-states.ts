/**
 * The request statuses that say an ask's answer is in (the service's stored rows: an answer applied or proposed, a reply,
 * or nothing to change): a save doesn't ask again (the outliner's agent-requests.ts), and the door's row for an ask
 * answered before its draft opened reads `· answered` over them (PIE-1741). Under way, failed, held or withdrawn are not.
 */
export const ANSWERED_ASK_STATES: ReadonlySet<string> = new Set(["applied", "proposed", "replied", "nothing"]);
