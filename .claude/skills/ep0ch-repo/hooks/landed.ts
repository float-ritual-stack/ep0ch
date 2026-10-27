/**
 * Every merge on the record (PIE-1352): after a `gh pr merge` that ran, the merged PR is put on the outline's record
 * through the one writer, the outliner's `work deliver --repo R --pr N` with no item. It syncs each delivery that records
 * the PR (merged, with its merge commit and merged-at) and writes the PR's one landed row, ticket or not, so a day's
 * build log lists exactly that day's merges. Pure: register.ts runs gh and the CLI.
 */

/** The PR a merge named, as `gh pr view --json number,url,state` reads it: its repository and number, when merged. */
export function mergedPr(viewJson: string): { repo: string; number: number } | null {
  try {
    const view = JSON.parse(viewJson) as { number?: unknown; url?: unknown; state?: unknown }
    const repo = typeof view.url === 'string' ? /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/.exec(view.url)?.[1] : undefined
    return view.state === 'MERGED' && typeof view.number === 'number' && repo ? { repo, number: view.number } : null
  } catch {
    return null
  }
}

/** The outliner CLI call that lands it, from the repository's root, written as `actor`. */
export function landArgv(root: string, pr: { repo: string; number: number }, actor: string): string[] {
  return ['/bin/sh', `${root}/packages/outliner/scripts/run-bun.sh`, `${root}/packages/outliner/src/cli.ts`, 'work', 'deliver', `--repo=${pr.repo}`, `--pr=${pr.number}`, '--author=agent', `--actor=${actor}`]
}

/** What landing said, in one line for the agent that merged: the row, its tickets, or why it failed and the command. */
export function landedSaid(pr: { repo: string; number: number }, run: { exitCode: number; stdout: string; stderr: string }): string {
  const by = `bun packages/outliner/src/cli.ts work deliver --repo ${pr.repo} --pr ${pr.number}`
  if (run.exitCode !== 0) {
    const why = run.stderr.trim().split('\n').at(-1) || `exit ${run.exitCode}`
    return `${pr.repo}#${pr.number} merged but isn't on the record yet (${why}); land it with \`${by}\` from the repository.`
  }
  try {
    const out = JSON.parse(run.stdout) as { landed?: { blockId?: string; created?: boolean; tickets?: string[] } }
    const tickets = out.landed?.tickets ?? []
    return `${pr.repo}#${pr.number} is on the record: landed row ((${out.landed?.blockId ?? '?'}))` +
      (tickets.length ? `, delivering ${tickets.join(', ')}.` : ', with no ticket.')
  } catch {
    return `${pr.repo}#${pr.number}: \`${by}\` answered something unreadable; check the Landed page.`
  }
}
