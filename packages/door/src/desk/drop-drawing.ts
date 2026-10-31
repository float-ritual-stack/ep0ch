import { Canvas, type Rect } from "../canvas";
import { C, RESET, bg, chip as chipStyle, fg, width } from "../style";
import { rowLines } from "../text";
import { zonesOf, type Drop, type DropTile, type Refuse } from "./drop";

export function drawDrop<I>(canvas: Canvas, area: Rect, drop: Drop<I> | null, name: string, x: number, y: number, drawer?: string, tile?: DropTile<I>, src?: I, refuse?: Refuse<I>) {
  if (drop) {
    if (tile) {
      for (const zone of zonesOf(tile, src, refuse)) {
        const g = zone.ghost, active = zone.kind === drop.kind && (zone.kind !== "split" || drop.kind === "split" && zone.dir === drop.dir);
        const color = active ? zone.refused ? C.lred : C.yellow : C.dark;
        const ink = fg(color) + bg(C.black);
        canvas.clear(g, ink);
        canvas.box(g, ink);
        const inset = g.rows >= 3 && g.cols >= 4 ? 1 : 0;
        const room = g.cols - inset * 2;
        const lines = rowLines(zone.refused ? `✕ ${zone.refused}` : zone.label, room, Math.max(1, g.rows - inset * 2));
        const row = g.row + Math.floor((g.rows - lines.length) / 2);
        lines.forEach((line, i) => canvas.text(g.col + inset + Math.max(0, Math.floor((room - width(line)) / 2)), row + i, ink + line + RESET, room));
      }
    } else {
      const g = drop.ghost, why = drop.refused, color = why ? C.lred : C.yellow;
      canvas.box(g, fg(color), `${chipStyle(color, C.black)} ${why ? `✕ ${why}` : drop.label} ${RESET}`, "");
      if (drop.kind === "tabs" && !why) canvas.text(g.col + 1, g.row + 1, `${fg(C.yellow)}${"▀".repeat(Math.max(0, g.cols - 2))}${RESET}`, Math.max(0, g.cols - 2));
    }
  }
  const label = ` ⠿ ${name}${drawer ? ` · ${drawer}` : ""} `;
  // The carried name stays out of the bands, including when the pointer is just above their words.
  const bounds = tile?.rect ?? area;
  const ly = tile ? bounds.row : Math.max(area.row, Math.min(area.row + area.rows - 1, y + 1));
  const lx = Math.max(bounds.col, Math.min(bounds.col + bounds.cols - width(label), x + 1));
  canvas.text(lx, ly, `${chipStyle(drawer ? C.yellow : C.magenta, C.black)}${label}${RESET}`, bounds.cols);
}
