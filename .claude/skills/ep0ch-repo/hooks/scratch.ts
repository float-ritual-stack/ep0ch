/**
 * Which `rm -r` commands are scratch cleanup. Claude Code stops on a "dangerous rm" (the working folder, a `..`, a
 * glob that reaches it) even under bypass permissions, and a builder's prompt waits in the deployer's session; the
 * mod answers "allow" for a command that is nothing but `rm -r` of folders under the scratch roots, and leaves
 * every other command to the normal prompt. Pure: register.ts resolves the paths (`realpath -m`) and asks this.
 */

import { simpleCommands } from './shell'

export type ScratchContext = { uid: string; home: string; cwd: string }

/** The scratch roots, `scripts/scratch-clean`'s (a worktree under ~/wt goes by `git worktree remove`, not here). */
export function scratchRoots(ctx: ScratchContext): string[] {
  return [`/tmp/claude-${ctx.uid}`, `/tmp/ep0ch-agent-${ctx.uid}`, `${ctx.home}/.agent-env`]
}

/** Whether the resolved `path` is inside one of the roots (not a root itself). */
export function underScratch(path: string, ctx: ScratchContext): boolean {
  return scratchRoots(ctx).some(root => path.startsWith(`${root}/`) && path.length > root.length + 1)
}

/** The `rm` it runs: this one, never another executable of that name. */
const RM = ['rm', '/bin/rm', '/usr/bin/rm']

/** rm's options that stay within "remove these folders": recursive, force, verbose, and the end of options. */
const OPTIONS = /^-[rRfv]+$|^--(recursive|force|verbose)$/

/**
 * The paths `command` removes when it is only `rm -r` commands over plain words (a variable, glob, brace, command
 * substitution or redirection is a path nobody can read from here); null for anything else, or no path at all.
 * `~` and `~/` are the home folder; the rest is as written, for the caller to resolve against the working folder.
 */
export function scratchRemovals(command: string, ctx: ScratchContext): string[] | null {
  // The shell expands an unquoted ~ only, and the words below come back without their quotes.
  if (/["'\\]~/.test(command)) return null
  const targets: string[] = []
  const commands = simpleCommands(command, { unwrap: false })
  if (!commands.length) return null
  for (const words of commands) {
    if (!RM.includes(words[0] ?? '')) return null
    let recursive = false
    let done = false
    for (const w of words.slice(1)) {
      if (!done && w === '--') { done = true; continue }
      if (!done && w.startsWith('-')) {
        if (!OPTIONS.test(w)) return null
        if (/^-[^-]*[rR]|^--recursive$/.test(w)) recursive = true
        continue
      }
      if (w.startsWith('~') && w !== '~' && !w.startsWith('~/')) return null
      if (/[$?{}`<>\\]/.test(w) || (/[*[\]!]/.test(w) && contentsOf(w) === null)) return null
      targets.push(w === '~' ? ctx.home : w.startsWith('~/') ? `${ctx.home}/${w.slice(2)}` : w)
    }
    if (!recursive) return null
  }
  return targets.length ? targets : null
}

/** The glob endings that mean "everything in the folder": `*` and `.[!.]*` (the hidden entries, not `..`). */
const CONTENTS = ['*', '.[!.]*']

/** The folder a `<folder>/*` (or `.[!.]*`) word empties, or null when the word isn't one (its folder has no glob in it). */
export function contentsOf(word: string): string | null {
  const at = word.lastIndexOf('/')
  const [folder, last] = at < 0 ? ['.', word] : [at === 0 ? '/' : word.slice(0, at), word.slice(at + 1)]
  return CONTENTS.includes(last) && !/[*?[\]!]/.test(folder) ? folder : null
}

/** A command word read as written (`$` and the like make `scratchRemovals` give up before this). */
export function absolute(path: string, cwd: string): string {
  return path.startsWith('/') ? path : `${cwd}/${path}`
}
