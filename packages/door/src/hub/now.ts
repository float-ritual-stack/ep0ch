// Which page is "now": the welcome screen (C on the main menu) shows it while no note is tagged welcome, and
// the daily layout's "now" tile shows it.

/**
 * The "now" page: what the welcome screen shows with no welcome notes, and what the daily layout's "now" tile
 * shows. `claude-now` (the agents' running status page on a float-hub outline) unless EP0CH_NOW_PAGE names
 * another page, such as a briefing; EP0CH_NOW_LABEL names it where it's pinned on its own.
 */
export function nowPage(env: Record<string, string | undefined> = process.env): { address: string; label: string } {
  const address = env.EP0CH_NOW_PAGE?.trim() || "claude-now";
  const label = env.EP0CH_NOW_LABEL?.trim() || (address === "claude-now" ? "Claude · now" : address);
  return { address, label };
}
