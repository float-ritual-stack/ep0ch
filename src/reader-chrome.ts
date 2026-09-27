import {truncateToWidth, visibleWidth} from "@earendil-works/pi-tui";
import {outlinerActionLink, type OutlinerActionMenuItem, type OutlinerActionSurface} from "./outliner-actions";
import {sanitizeDynamicText} from "./terminal";

export type ReaderDensity = "compact" | "expanded";
export type ReaderMenu = "note" | "view" | "links" | "props" | "all";
export const READER_MENUS: readonly ReaderMenu[] = ["note", "view", "links", "props", "all"];
const labels: Record<ReaderMenu, string> = {note: "Note", view: "View", links: "Links", props: "Props", all: "⋯"};

/** Categories are projections of the action registry, never another action list. */
export function readerMenuItems(items: readonly OutlinerActionMenuItem[], menu: ReaderMenu): OutlinerActionMenuItem[] {
  if (menu === "all") return [...items];
  return items.filter(item => {
    if (item.id.includes(".menu.")) return false;
    if (menu === "props") return item.id.includes(".property.") || item.id.includes(".properties.");
    if (menu === "links") return item.group === "Navigate" || item.group === "Pane";
    if (menu === "view") return item.group === "View" || item.group === "System";
    return item.group === "Edit";
  });
}

export function readerMenuFromAction(action: string): ReaderMenu | null {
  const match = /^(?:tree|detail)\.menu\.(note|view|links|props|open)$/.exec(action);
  return match ? match[1] === "open" ? "all" : match[1] as ReaderMenu : null;
}

/** Keep labels whole; the overflow always contains the full effective action list. */
export function renderReaderMenu(surface: OutlinerActionSurface, width: number, identity = ""): string {
  const overflow = outlinerActionLink(`${surface}.menu.open`, "[⋯]");
  if (width <= 3) return truncateToWidth(overflow, Math.max(0, width));
  const safeIdentity = sanitizeDynamicText(identity);
  const identityWidth = safeIdentity ? Math.min(Math.floor(width / 2), Math.max(0, width - 5)) : 0;
  let row = identityWidth ? truncateToWidth(safeIdentity, identityWidth) + " " : "";
  for (const menu of READER_MENUS.filter(menu => menu !== "all")) {
    const label = `[${labels[menu]}]`;
    if (visibleWidth(row) + visibleWidth(label) + 4 > width) break;
    row += outlinerActionLink(`${surface}.menu.${menu}`, label) + " ";
  }
  return row + overflow;
}

export function adjacentReaderMenu(menu: ReaderMenu, delta: number): ReaderMenu {
  return READER_MENUS[(READER_MENUS.indexOf(menu) + delta + READER_MENUS.length) % READER_MENUS.length]!;
}
