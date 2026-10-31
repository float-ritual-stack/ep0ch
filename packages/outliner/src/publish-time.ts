import { fromWallClock, readDate } from "@ep0ch/outline-core/dates";
import { escapeHtml } from "./publish";

/** The instant survives publication; the reader script supplies the viewer's clock. */
export function timeHtml(iso: string): string {
  const utc = new Date(iso).toISOString();
  return `<time datetime="${escapeHtml(iso)}">${utc.slice(0, 16).replace("T", " ")} UTC</time>`;
}

/** Date-only values remain calendar dates, never shifted to another day by a time zone. */
export function dateTimeHtml(value: string): string | undefined {
  const date = readDate(value);
  return date && date.from === date.to ? timeHtml(new Date(fromWallClock(date.from)).toISOString()) : undefined;
}
