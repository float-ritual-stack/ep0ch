import {execFile} from "node:child_process";
import {hostname} from "node:os";
import {promisify} from "node:util";
import type {OutlinerRequester} from "./client-target";
import type {CaptureOwner} from "./types";

/** Focus only the explicitly addressed local Herdr session; never reinterpret a
 * pane ID from another host/session as one in the caller's layout. */
export async function focusCaptureOwner(owner: CaptureOwner): Promise<void> {
  if (owner.hostname !== hostname() || owner.herdrSocket !== process.env.HERDR_SOCKET_PATH) {
    throw Error(`Capture is already open in another Herdr session on ${owner.hostname}; retain or close that draft there first`);
  }
  // A popup already owns the foreground of this Herdr session. Herdr's plugin
  // pane focus API addresses ordinary split panes, not its transient popup.
  if (!owner.popup) await promisify(execFile)(process.env.HERDR_BIN_PATH ?? "herdr",
    ["plugin", "pane", "focus", owner.paneId], {timeout: 10_000});
}

export async function focusActiveCapture(client: OutlinerRequester): Promise<boolean> {
  const owner = await client.request<CaptureOwner | null>({action: "capture.owner.get"});
  if (!owner) return false;
  await focusCaptureOwner(owner);
  return true;
}
