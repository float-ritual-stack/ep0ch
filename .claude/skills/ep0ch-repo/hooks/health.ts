// The drain's clock asks this rule; register.ts owns the persistent week and prompt delivery.
const toronto = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
})

export function healthDue(now: number): { week: string; date: string } | null {
  const parts = Object.fromEntries(toronto.formatToParts(now).map(p => [p.type, p.value]))
  if (parts.weekday !== 'Sun' || Number(parts.hour) < 18) return null
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const thursday = new Date(`${date}T00:00:00Z`)
  thursday.setUTCDate(thursday.getUTCDate() - 3)
  const year = thursday.getUTCFullYear()
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7)
  return { date, week: `${year}-W${String(week).padStart(2, '0')}` }
}

export function healthPrompt(date: string): string {
  return [
    `Code health, ${date} (PIE-1378; the ep0ch-repo mod's Sunday evening pass, America/Toronto).`,
    'Read PIE-1378 and the census under PIE-1376. Keep code read-only throughout this pass.',
    '1. Read main in a private detached worktree: `git fetch origin main`, then `git worktree add --detach <scratch-worktree> origin/main`; ' +
      'run `bun install --frozen-lockfile` there. Never switch or edit the live checkout.',
    '2. Read the latest [type::health-pass] note under PIE-1376. Save its JSON figures as previous.json in your private scratch folder. ' +
      'From the main worktree run `bun scripts/health-ratchet.ts --report <absolute-path-to-previous.json>` and ' +
      '`bun scripts/health-ratchet.ts --report <absolute-path-to-previous.json> --json`. ' +
      'For the first pass, run `bun scripts/health-ratchet.ts --report` and `bun scripts/health-ratchet.ts --report --json`; they compare with the baseline.',
    '3. Pick one hotspot using size, commits over 7 days and growth together. Check PIE-1376 for its inventory first. ' +
      'Only if it has none, inventory that file end to end with readers over slices, using the existing note.ts inventory format. ' +
      'Spot-check any bug claim against the actual code before writing it.',
    `4. If there is a finding or a meaningful delta, write exactly one note titled "Code health, ${date}" under PIE-1376, with [type::health-pass]. ` +
      'Include the main SHA, files over 1,000 and 2,000 lines, growth and ratchet-count deltas against the previous pass (or baseline), ' +
      '7-day per-file commits, top co-change pairs, the one hotspot and its inventory link. Keep the --json figures in a collapsed evidence section for the next pass.',
    '5. Inventory writing and bundled, deduplicated #hydra tickets are loki\'s work, following PIE-1378; this mod does neither. ' +
      'A true duplicate or verified bug gets "Done when: one owner, old copies deleted in the same PR."',
    'If there is nothing to report, say "Code health: nothing to report." in one gurgle line; write no health note and file no tickets. ' +
      'Clean up your private worktree with `scripts/scratch-clean <scratch-worktree>`.',
  ].join('\n')
}
