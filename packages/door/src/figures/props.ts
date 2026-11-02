// `::graph-props`: a properties table (PIE-1032), the one drawing of "what this takes": a component's properties on its
// library page, an action's arguments on its page, an extension's settings. A row is a name, the values it takes, its
// default (or *needed*), and what it means under it, dim; a `where` column when the rows say where each is written.
//
//   ::graph-props                                   props:                                 (the YAML form)
//   ---                                               - { name: to, values: a tile, needed: true,
//   title: layout.move                                    meaning: the tile it goes beside }
//   ---
//   - **to**: a tile — the tile it goes beside      a bold name is one that's needed
//   - where: left, right, tabs · right — which side of it
//   ::
import { ellipsize, fg, pad, RESET, width as vwidth } from "../style";
import { rowLines, wrap } from "../text";
import { ACCENT, DIM, HI, INK, records, rowLink, tier, type Props, type RowLink } from "./palette";

/** One row of a properties table. */
export interface PropRow { name: string; values?: string; default?: string; meaning?: string; needed?: boolean; where?: string; block?: string }

/** The widest the values column grows; longer values wrap in it. */
const VALUES_MAX = 36;
/** The narrowest meaning column drawn beside its row; narrower, the meaning goes under. */
const MEANING_MIN = 28;

/** The rows `w` wide: the heads, then each row with its meaning beside it when there's room, else under it. */
export function drawProps(p: Props, w: number, link?: RowLink): string[] {
  const rows: PropRow[] = records(p.props).map(r => ({ ...r, name: String(r.name ?? r.key ?? "") }) as PropRow);
  if (!rows.length) return [fg(DIM) + "nothing to list" + RESET];
  const dflt = (r: PropRow) => (r.needed ? "needed" : r.default ?? "");
  const nw = Math.min(24, Math.floor(w / 3), Math.max(4, ...rows.map(r => vwidth(r.name))));
  const wantW = rows.some(r => r.where) ? Math.min(22, Math.max(5, ...rows.map(r => vwidth(r.where ?? "")))) : 0;
  const wantD = rows.some(dflt) ? Math.min(14, Math.max(7, ...rows.map(r => vwidth(dflt(r))))) : 0;
  // Columns go, `where` first, then the default (said after the values), until the values have room.
  const fits = (ww: number, dw: number) => nw + 2 + (ww ? ww + 2 : 0) + (dw ? dw + 2 : 0) + 12 <= w;
  const narrow = tier(w) === "narrow" || !fits(0, wantD);
  const ww = !narrow && fits(wantW, wantD) ? wantW : 0;
  const dw = narrow ? 0 : wantD;
  // The values take what they need (up to VALUES_MAX), never the rest of the row: the default stays beside its name
  // (PIE-1515: a wide tile put it 1,900 px away). What is left past the default is the meaning's column when it has
  // MEANING_MIN; else the meaning hangs under its row.
  const rest = Math.max(6, w - nw - 2 - (ww ? ww + 2 : 0) - (dw ? dw + 2 : 0));
  const vw = Math.min(rest, VALUES_MAX, Math.max(6, ...rows.map(r => vwidth(r.values ?? ""))));
  const mw = !narrow && rows.some(r => r.meaning) && rest - vw - 2 >= MEANING_MIN ? rest - vw - 2 : 0;
  const out: string[] = [];
  out.push(fg(DIM) + pad("name", nw) + "  " + (ww ? pad(String(p.where ?? "where"), ww) + "  " : "") + pad("values", vw) + (dw ? "  " + pad("default", dw) : "") + (mw ? "  meaning" : "") + RESET);
  for (const r of rows) {
    const values = narrow && dflt(r) ? `${r.values ?? ""} · ${dflt(r)}` : r.values ?? "";
    const names = rowLines(rowLink(link, r.block, r.name), nw), valuesRows = rowLines(values, vw);
    const where = ww ? rowLines(r.where ?? "", ww) : [], defaults = dw ? rowLines(dflt(r), dw) : [];
    const means = mw && r.meaning ? rowLines(String(r.meaning), mw, Infinity) : [];
    for (let i = 0; i < Math.max(names.length, valuesRows.length, where.length, defaults.length, means.length); i++) {
      out.push((r.needed ? fg(ACCENT) : fg(HI)) + pad(names[i] ?? "", nw) + "  " + (ww ? fg(INK) + pad(where[i] ?? "", ww) + "  " : "") + fg(HI) + pad(valuesRows[i] ?? "", vw) + (dw ? "  " + (r.needed ? fg(ACCENT) : fg(INK)) + pad(defaults[i] ?? "", dw) : "") + (mw ? "  " + fg(DIM) + (means[i] ?? "") : "") + RESET);
    }
    if (mw) continue;
    // What it means under its values, as the library's table had it; from the left edge when narrow.
    const at = narrow ? 2 : nw + 2;
    if (r.meaning) for (const l of rowLines(String(r.meaning), Math.max(8, w - at))) out.push(" ".repeat(at) + fg(DIM) + l + RESET);
  }
  return out;
}
