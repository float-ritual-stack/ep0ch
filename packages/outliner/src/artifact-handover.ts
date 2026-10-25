// After the watcher has taken a server-side drop (PIE-1267): the card that lands in the note the sender meant (today's
// in the lease's outline), and the record of the arrival. The watcher is a separate process with no outline of its own,
// so both go through the outline host like any client. A host that isn't up doesn't undo an install: the answer says
// the card wasn't written, with the command that makes it.
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlinerClient } from "./client";
import type { Block, PageAddressFollowResult, PageAddressResolution } from "./types";
import type { DropMeta } from "./artifact-inbox";

/** The page the arrival records go under, in `EP0CH_ARTIFACT_RECORDS`'s outline (else the sender's). */
export const UPLOADS_PAGE = "artifact-uploads";

export interface Arrival {
  installed?: { name: string; version: number; title?: string };
  /** Why the drop was refused. */
  reason?: string;
}

/** A line of text for a note: no brackets or line breaks that would read as a property or a new block. */
const oneLine = (value: string, max = 120) => value.replace(/[\[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** What the page's `<title>` says, or undefined when it has none. */
export function pageTitle(html: string): string | undefined {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (!raw) return undefined;
  const title = oneLine(raw.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  return title || undefined;
}

/**
 * Writes the card (when installed) and the record. Never throws: each says what happened, `card` and `record` being
 * what the sender is told.
 */
export async function handOver(outlines: string, meta: DropMeta, arrival: Arrival, env: NodeJS.ProcessEnv = process.env): Promise<{ card: string; record: string }> {
  const socket = outlineLayout(outlines).socket;
  const as = meta.via === "lease" && meta.by !== "you" ? { author: "agent" as const, provenance: { actorId: meta.by } } : { author: "user" as const };
  const client = (outline: string) => new OutlinerClient(socket, 15_000, outline);

  let card = "No card: the upload was refused.";
  if (arrival.installed) {
    try {
      const { name, title } = arrival.installed;
      const mine = client(meta.outline);
      const noted = meta.note ? await mine.request<PageAddressResolution>({ action: "pages.resolve", address: meta.note }) : undefined;
      const parent = noted?.status === "resolved" && noted.block ? noted.block : (await mine.request<PageAddressFollowResult>({ action: "pages.follow", address: localDay(), ...as })).block;
      if (!parent) throw new Error("today's note is unavailable");
      await mine.request<Block>({ action: "create", parentId: parent.id, text: `${oneLine(title ?? name)}\n[artifact::${name}]`, ...as });
      card = noted?.status === "resolved" ? `A card for ${name} is under ${meta.note} in ${meta.outline}.`
        : `A card for ${name} is in ${meta.outline}'s note for today${meta.note ? ` (no note ${oneLine(meta.note, 60)} was found)` : ""}.`;
    } catch (error) {
      card = `No card was written (${error instanceof Error ? error.message : String(error)}); the artifact is installed. Add it with [artifact::${arrival.installed.name}] in a note.`;
    }
  }

  let record: string;
  try {
    const outline = env.EP0CH_ARTIFACT_RECORDS?.trim() || meta.outline;
    const book = client(outline);
    const page = await book.request<PageAddressFollowResult>({ action: "pages.follow", address: UPLOADS_PAGE, author: "system" });
    if (!page.block) throw new Error("the uploads page is unavailable");
    const where = arrival.installed ? `Uploaded ${arrival.installed.name} version ${arrival.installed.version}` : `Refused ${oneLine(meta.filename, 60)}`;
    const via = meta.via === "lease" ? `lease ${meta.source}, minted by ${oneLine(meta.by)}` : `device ${oneLine(meta.source)}`;
    await book.request<Block>({
      action: "create", parentId: page.block.id, author: "system",
      text: `${where} [type::upload-record] [machine::upload] [state::${arrival.installed ? "installed" : "refused"}]${arrival.installed ? ` [artifact-name::${arrival.installed.name}]` : ""}\n` +
        `Arrived: ${meta.at}\nVia: ${via}\nFor: ${meta.outline}${meta.note ? `, ${oneLine(meta.note, 60)}` : ""}\nFile: ${oneLine(meta.filename, 100)} (${size(meta.bytes)})\nSHA-256: ${meta.sha256}` +
        (arrival.reason ? `\nWhy: ${oneLine(arrival.reason, 400)}` : ""),
    });
    record = `Recorded under ${UPLOADS_PAGE} in ${outline}.`;
  } catch (error) {
    record = `Not recorded (${error instanceof Error ? error.message : String(error)}).`;
  }
  return { card, record };
}
