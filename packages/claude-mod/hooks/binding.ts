import type { RenderElement } from 'claude-code'

import type { BindingFacts, FolderFacts, WhereFacts } from '../types'

export type { BindingFacts, FolderFacts, WhereFacts }

/**
 * Where this Claude is bound (PIE-546): which outline its tools use, on which
 * machine, why, where Claude itself runs, and the door and Herdr pane around
 * it. Shown three ways from one set of facts: a card in the band above the
 * prompt (at the start and after `/clear`, until hidden), a status line that
 * stays, and a context block the model reads at the start.
 *
 * The facts come from two places only, never guessed here:
 * - the outline the folder names: the installed CLI's `bound-folder` (the
 *   outline lookup rule every client applies, the one the outline, workboard
 *   and mention tools already use: `references.workspace` in register.ts);
 * - the rest: `ep0ch where --json` (this machine and folder, the door, its
 *   outline and the machine it is on, the Herdr pane).
 *
 * This file is the pure half: what an answer means, the words and the tree.
 * register.ts runs the commands and keeps the state.
 */

/** One line of the card: its label, its words, and how it is drawn. */
export type CardLine = { label: string; text: string; tone?: 'warn' | 'dim' | 'command' }

export const BINDING_BLOCK = 'outlineBinding'
export const BINDING_COMMAND = 'outline'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 200) : null)

/** `ep0ch where --json`'s answer as the facts the card reads, or null when it isn't one. */
export function whereFactsOf(stdout: string): WhereFacts | null {
  let w: any
  try { w = JSON.parse(stdout) } catch { return null }
  if (!w || typeof w !== 'object' || typeof w.inDoor !== 'boolean') return null
  const door = w.door && typeof w.door === 'object' ? w.door : null
  const herdr = w.herdr && typeof w.herdr === 'object' && str(w.herdr.pane) ? w.herdr : null
  return {
    inDoor: w.inDoor,
    here: { machine: str(w.here?.machine), folder: str(w.here?.folder) },
    herdr: herdr ? { pane: str(herdr.pane)!, label: str(herdr.label), agent: herdr.agent === true } : null,
    door: door ? {
      answers: door.answers === true,
      outline: str(door.outline),
      machine: str(door.machine),
      host: str(door.host),
      drawer: door.tile?.drawer === true,
      tile: str(door.tile?.name),
    } : null,
  }
}

/** A path with HOME written `~`. */
export function short(path: string, home?: string): string {
  const h = home?.replace(/\/+$/, '')
  return h && (path === h || path.startsWith(`${h}/`)) ? `~${path.slice(h.length)}` : path
}

/** The machine an outline is on, in words: its ssh name, or this machine (by name when known). */
function machineWords(machine: string | undefined | null, here: string | null): string {
  return machine ? `${machine} (another machine)` : here ? `this machine (${here})` : 'this machine'
}

/** The short form for the status line. */
function machineShort(machine: string | undefined | null, here: string | null): string {
  return machine ?? here ?? 'this machine'
}

/**
 * The machine the door's outline is on, when not this one: the ssh name the
 * door reached it by, else (a host named outright, EP0CH_SOCKET) the host's own
 * name when it isn't this machine's. Null: this machine.
 */
function doorMachine(f: BindingFacts): string | null {
  const door = f.where?.door
  if (!door) return null
  if (door.machine) return door.machine
  const here = f.where?.here.machine
  return door.host && here && door.host !== here ? door.host : null
}

/** The folder's outline and the door's are the same outline on the same machine. */
function sameOutline(f: BindingFacts): boolean {
  const door = f.where?.door
  if (f.folder.kind !== 'bound' || !door?.outline) return false
  const ws = f.folder.workspace
  return ws.outline === door.outline && (ws.machine ?? null) === doorMachine(f)
}

/** The command that binds Claude's folder to an outline: the door's when Claude is in one, else a name to choose. */
export function initCommand(f: BindingFacts): string {
  const door = f.where?.door
  const machine = f.where?.door?.machine
  if (door?.outline) return `ep0ch init ${door.outline}${machine ? ` --machine ${machine}` : ''}`
  return 'ep0ch init <name>'
}

/** The folder names one outline and the door is on another: the yellow line, or null. */
export function mismatchOf(f: BindingFacts): string | null {
  const door = f.where?.door
  if (f.folder.kind !== 'bound' || !door?.outline || !f.folder.workspace.outline || sameOutline(f)) return null
  const ws = f.folder.workspace
  const here = f.where?.here.machine ?? null
  if (ws.outline !== door.outline) {
    return `this folder names ${ws.outline}; you're in ${door.outline}'s door. The outline tools write to ${ws.outline}; the door tools act in ${door.outline}'s door.`
  }
  const folderAt = `${ws.outline} on ${machineShort(ws.machine, here)}`
  const doorAt = `${door.outline} on ${machineShort(doorMachine(f), here)}`
  return `this folder names ${folderAt}; the door you're in shows ${doorAt}. The outline tools write to ${folderAt}; the door tools act in that door.`
}

/** Where Claude sits in the door: its drawer, a tile, or not in one; and its Herdr pane. */
function doorWords(f: BindingFacts): string {
  const w = f.where
  const door = w?.door
  const herdr = w?.herdr
  const pane = herdr ? (herdr.label ? `Herdr pane ${herdr.label}` : 'a Herdr pane') : null
  if (!w) return `not checked: ${f.whereWhy ?? '`ep0ch where` did not answer'}`
  if (!w.inDoor || !door) return ['not in a door', pane && `in ${pane}`].filter(Boolean).join(' · ')
  const which = door.outline ? `the ${door.outline} door` : 'a door'
  const seat = door.drawer ? `the drawer of ${which}` : door.tile ? `the "${door.tile}" tile of ${which}` : `a tile of ${which}`
  const parts = [door.answers ? `in ${seat}` : `in ${seat}, but no door answers now`]
  if (pane) parts.push(herdr!.agent ? `its own ${pane}` : pane)
  return parts.join(' · ')
}

/**
 * The card's lines, in order. Plain words: outline, machine, door, folder.
 * `compact`: the lines that say the binding only (outline, why, the command,
 * the yellow line), for a band shared with Recent mentions.
 */
export function cardLines(f: BindingFacts, compact = false): CardLine[] {
  const here = f.where?.here.machine ?? null
  const lines: CardLine[] = []
  const door = f.where?.door
  switch (f.folder.kind) {
    case 'bound': {
      const ws = f.folder.workspace
      if (ws.outline) {
        lines.push({ label: 'outline', text: `${ws.outline}, on ${machineWords(ws.machine, here)}` })
        lines.push({ label: 'why', text: `${short(ws.root, f.home)}/.ep0ch names it${sameOutline(f) ? ", and the door you're in is on it too" : ''}` })
      } else {
        lines.push({ label: 'outline', text: `the one the Outliner finds for ${short(ws.root, f.home)}` })
        lines.push({ label: 'why', text: `${short(ws.root, f.home)} is in the mod's folder list, in strict mode (only listed folders feed)` })
      }
      break
    }
    case 'unbound':
    case 'opted-out':
      lines.push({ label: 'outline', text: 'none: the outline, workboard and mention tools are off' })
      lines.push({
        label: 'why',
        text: f.folder.kind === 'opted-out'
          ? `${short(f.folder.root, f.home)} is opted out in the mod's folder list`
          : `nothing names one in ${short(f.cwd, f.home)} or above it (no .ep0ch)${door?.outline ? `; the door tools still act in the ${door.outline} door` : ''}`,
      })
      if (f.folder.kind === 'unbound') lines.push({ label: 'bind it', text: initCommand(f), tone: 'command' })
      break
    case 'failed':
      lines.push({ label: 'outline', text: 'not known: the outline tools are off' })
      lines.push({ label: 'why', text: f.folder.why })
      break
  }
  const mismatch = mismatchOf(f)
  if (mismatch) lines.push({ label: 'careful', text: mismatch, tone: 'warn' })
  if (compact) return lines
  lines.push({ label: 'Claude', text: `runs on ${here ?? 'this machine'} in ${short(f.cwd, f.home)}` })
  lines.push({ label: 'door', text: doorWords(f) })
  const away = doorMachine(f)
  if (door?.outline && away) lines.push({ label: '', text: `the ${door.outline} door's outline is on ${away}${door.host && door.host !== away ? ` (${door.host})` : ''}`, tone: 'dim' })
  lines.push({ label: 'tools', text: 'one set, from the ep0ch Claude mod', tone: 'dim' })
  return lines
}

/** The status line: `outline: <name> @ <machine> · <via>`. */
export function statusLine(f: BindingFacts | null): string {
  if (!f) return 'outline: finding…'
  const here = f.where?.here.machine ?? null
  const door = f.where?.door
  const doorAt = door?.outline ? `${door.outline} @ ${machineShort(doorMachine(f), here)}` : null
  switch (f.folder.kind) {
    case 'bound': {
      const ws = f.folder.workspace
      if (!ws.outline) return `outline: the Outliner's for ${short(ws.root, f.home)} · folder list`
      const at = `${ws.outline} @ ${machineShort(ws.machine, here)}`
      const via = !doorAt ? 'folder' : sameOutline(f) ? 'folder, door' : `folder · ⚠ door is ${doorAt}`
      return `outline: ${at} · ${via}`
    }
    case 'unbound':
      return `outline: none (tools off)${doorAt ? ` · door ${doorAt}` : ''} · ${initCommand(f)}`
    case 'opted-out':
      return `outline: none (opted out)${doorAt ? ` · door ${doorAt}` : ''}`
    case 'failed':
      return `outline: not known · ${f.folder.why.slice(0, 80)}`
  }
}

/** The same facts for the model, in its first prompt's context. */
export function bindingText(f: BindingFacts): string {
  const lines = cardLines(f).filter(l => l.label !== 'tools')
  return [
    'Which outline this Claude session is bound to (the ep0ch Claude mod, from the folder\'s .ep0ch as its tools find it and `ep0ch where --json`):',
    ...lines.map(l => `- ${l.label ? `${l.label}: ` : ''}${l.text}`),
    'The outline, workboard and mention tools use the folder\'s outline; the door tools (door_*) act in the door named above. Trust this over guesses; the person sees the same on a card and in the status line.',
  ].join('\n')
}

/** The elements the card is drawn with: the band's own. */
export type CardElements = {
  Box: (props: Record<string, unknown>) => RenderElement
  Text: (props: Record<string, unknown>) => RenderElement
  Button: (props: Record<string, unknown>) => RenderElement
}

/** The card's tree: a heading with its hide button, then one row per line, sized to `columns`. */
export function cardTree(ui: CardElements, f: BindingFacts | null, o: { columns: number; compact?: boolean; hide?: () => void }): RenderElement {
  const { Box, Text, Button } = ui
  const heading = Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: 'Where this Claude is bound ' }),
      ...(o.hide ? [Button({ key: 'binding-hide', hotkey: 'h', plain: true, label: 'hide (/outline shows it again)', onPress: o.hide })] : []),
    ],
  })
  const rows = f
    ? cardLines(f, o.compact).map((l, i) => Box({
        key: `binding-${i}`,
        flexDirection: 'row',
        children: [
          Box({ width: 9, flexShrink: 0, children: Text({ dimColor: true, children: l.label }) }),
          Box({
            flexGrow: 1, flexShrink: 1,
            children: Text({
              wrap: 'wrap',
              ...(l.tone === 'warn' ? { color: 'yellow' } : l.tone === 'dim' ? { dimColor: true } : l.tone === 'command' ? { color: 'cyan' } : {}),
              children: l.tone === 'warn' ? `⚠ ${l.text}` : l.text,
            }),
          }),
        ],
      }))
    : [Text({ dimColor: true, children: 'finding which outline this folder and door name…' })]
  return Box({ key: 'binding-card', flexDirection: 'column', width: Math.max(20, o.columns), children: [heading, ...rows] })
}
