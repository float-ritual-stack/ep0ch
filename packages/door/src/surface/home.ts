import { renderDoc } from "../doc";
import { BOLD, C, fg, RESET, width } from "../style";
import type { Key } from "../term";

/** Empty places use the document's buttons and keys figure, without inventing a note in the outline. */
export class HomeSurface {
  private controls: { row: number; from: number; to: number; action: string }[] = [];
  render(title: string, cols: number, rows: number, agents = false): string[] {
    const buttons = agents
      ? [['New Agent', 'agents.new'], ['Shell', 'host.shell']]
      : [['Search or command', 'bar.open'], ['New note', 'note.new'], ['Shell', 'host.shell'], ['Agent', 'host.agent']];
    const body = [
      `ep0ch · ${title}`, "",
      ...buttons.map(([label, act]) => `::button{label="${label}" act="${act}"}`), "",
      '::graph-keys', '---', 'title: Getting about', '---',
      ...(agents ? ['- n: new agent'] : ['- ctrl+n: new note']),
      '- ctrl+k: power bar', '- alt+s: shell', '- ( ) then f: fold', '- esc: close', '- q: back', '::',
    ].join('\n');
    const doc = renderDoc(body, {
      width: cols, cellW: 9, cellH: 16, graphics: false, maxImageRows: 0, unfold: true,
      button: call => [buttonLabel(call.label)],
    });
    this.controls = buttons.flatMap(([label, action]) => {
      const row = doc.lines.findIndex(l => l.includes(`[${label}]`));
      if (row < 0) return [];
      const before = doc.lines[row]!.split(`[${label}]`)[0]!;
      return [{ row, from: width(before), to: width(before) + width(`[${label}]`), action: action! }];
    });
    return doc.lines.slice(0, rows);
  }
  press(k: Key, run: (action: string) => void): boolean {
    if (k.kind !== "mouse" || k.action !== "down" || k.button !== 0) return false;
    const hit = this.controls.find(c => k.y === c.row && k.x >= c.from && k.x < c.to);
    if (!hit) return false;
    run(hit.action);
    return true;
  }
}

export const buttonLabel = (label: string) => fg(C.lcyan) + BOLD + `[${label}]` + RESET;
