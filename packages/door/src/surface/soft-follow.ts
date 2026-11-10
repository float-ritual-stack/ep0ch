// Following a link to something that may not be one place (PIE-408, PIE-544): a soft link, which the service says where
// it lands, and a `[[address]]` nothing answers. One note opens; none is offered, made by the next press, never silently;
// several are a chooser over the screen, never a guess. An agent's moves nothing: it's told, and makes one with
// `page.create` or opens one with `open id=`. The reader (note.ts) hands itself over as a `PageOfferReader`.
import { errorDetails } from "../status-log";
import { subject, type Msg } from "../board";
import { printable } from "../props";
import { isOutlineNote } from "../authored";
import type { LinkTarget } from "../refs";
import { recordedAnswer, USER, type Actor, type RecordedAs, type SoftLinkChoice } from "../socket";
import { ActionRefused } from "./actions";
import type { Again } from "../arm";
import type { OpenHow, SurfaceHost } from "./note";
import { centred, ListPicker, pickRow } from "./picker";

/** How long an offer stands: never a create long after, unannounced. */
export const PAGE_OFFER_MS = 60_000;

/** The `[[address]]` whose page the next ⏎ or click on its link makes, as said; gone with the note. */
export interface PageOffer { page: string; notice: string }

/** A soft link with more than one place to land, told to an agent (the person gets a chooser). */
export interface SoftChoices { words: string; choices: { label: string; context?: string; id?: string; create?: { address: string; under?: string } }[] }

/** The reader, as much of it as an offer needs. */
export interface PageOfferReader {
  readonly msg: Msg | null;
  notice: string;
  readonly pageOffer: Again<PageOffer>;
  runKey(action: string, args: Record<string, unknown>, host: SurfaceHost): Promise<unknown> | unknown;
  follow(id: string, host: SurfaceHost, how: OpenHow): Promise<Msg | null>;
  shown(m: Msg, host: SurfaceHost, how: OpenHow): void;
}

/** A soft link: the service's answer, acted on. */
export async function followSoft(r: PageOfferReader, soft: NonNullable<LinkTarget["soft"]>, host: SurfaceHost, how: OpenHow): Promise<Msg | SoftChoices | null> {
  const blockId = soft.block ?? (r.msg && isOutlineNote(r.msg) ? r.msg.id : undefined);
  const answer = await host.ctx.board.softLink(soft.name, { ...(blockId ? { blockId } : {}), ...(soft.line !== undefined ? { line: soft.line } : {}) });
  const [only] = answer.candidates;
  if (answer.status === "ambiguous") return offerChoices(r, answer.words, answer.candidates, host, how);
  if (only?.note) return r.follow(only.note.id, host, how);
  if (only?.create) return offerPage(r, only.create.address, host, only.create.under);
  host.ctx.flash(`nothing answers at ${answer.words}`);
  return null;
}

/** More than one place a soft link could land: the person picks over the screen; an agent is told. */
function offerChoices(r: PageOfferReader, words: string, choices: readonly SoftLinkChoice[], host: SurfaceHost, how: OpenHow): SoftChoices | null {
  const listed = choices.map(c => ({ label: c.label, ...(c.context ? { context: c.context } : {}), ...(c.note ? { id: c.note.id } : {}), ...(c.create ? { create: c.create } : {}) }));
  if (host.actor?.kind === "agent") return { choices: listed, words };
  const read = (c: SoftLinkChoice) => `${c.note ? subject(c.note) : c.label}${c.context ? ` · ${c.context}` : ""}${c.note ? "" : " · make it"}`;
  if (!host.overlay) { host.ctx.flash(`more than one ${words}: ${choices.map(read).join(", ")} · open the one you mean from the outline`, 8000); return null; }
  host.overlay(new ListPicker<SoftLinkChoice, unknown>({
    name: "soft-link", items: () => choices, clickChooses: true,
    row: (c, _i, on, w) => [pickRow(printable(read(c)), on, w)],
    choose: c => {
      const opened = c.note ? r.follow(c.note.id, host, how) : createPage(r, c.create!.address, host, USER, true, c.create!.under);
      void Promise.resolve(opened).catch((e: Error) => host.ctx.flash(e.message, undefined, errorDetails(e)));
    },
    frame: (a, n) => ({ rect: centred(a, Math.min(64, a.cols - 2), Math.min(n + 2, a.rows)), title: `more than one ${words} · pick one` }),
  }));
  return null;
}

/**
 * A followed `[[address]]` nothing answers (PIE-544): never made silently. The first ⏎ or click offers it (said, and
 * kept under the header while this note is shown); the person's next ⏎ or click on that link makes it (`page.create`)
 * and opens it here. An agent following one is told, and makes it with page.create. `under`: it would be a note on that
 * page (a project's PR#125), not a page of its own.
 */
export async function offerPage(r: PageOfferReader, page: string, host: SurfaceHost, under?: string): Promise<null> {
  const by = host.actor ?? USER;
  const named = under ? `${page} under [[${under}]]` : `[[${page}]]`, make = under ? { address: page, under } : { address: page };
  if (by.kind === "agent") throw new ActionRefused(`${named} doesn't exist yet: ${under ? "nothing there has that name" : "no page has that name"}; page.create address=${JSON.stringify(page)}${under ? ` under=${JSON.stringify(under)}` : ""} makes it`);
  // The offer stands while it's still said under the header, for a minute: never a create long after, unannounced.
  const o = r.pageOffer.armed();
  if (o && o.page === named && r.notice === o.notice) {
    r.pageOffer.clear();
    r.notice = "";
    await r.runKey("page.create", make, host);
    return null;
  }
  r.notice = `no ${under ? "" : "page "}${named} · ⏎ or click it again: create it`;
  r.pageOffer.arm({ page: named, notice: r.notice });
  host.ctx.flash(`${named} doesn't exist yet · ⏎ or click it again to create ${under ? "it" : "the page"}`, 8000);
  host.redraw();
  return null;
}

/** A note titled `text` on the page `under` names, made if it must be (a project's PR#125, on that project's page). */
async function createUnder(text: string, under: string, host: SurfaceHost, actor: Actor) {
  const home = await host.ctx.board.followPage(under, actor);
  if (!home.note) throw new Error(`[[${under}]] is a page in the trash: restore it there`);
  return { note: await host.ctx.board.createBlock(home.note.id, text, actor), created: true, status: "resolved" as const, placement: { said: `under ${subject(home.note)}` } };
}

/**
 * `page.create`: the page an `[[address]]` names, made where new notes go (the service's placement rule, today the top
 * of the Inbox) as `X [page::X]`, then opened as a followed link opens; one that exists already is opened. An agent's is
 * made and said, opening nothing.
 */
export async function createPage(r: PageOfferReader, address: string, host: SurfaceHost, actor: Actor, standing: boolean, under?: string): Promise<{ id: string; created: boolean; said?: string; recordedAs?: RecordedAs }> {
  const made = await (under ? createUnder(address, under, host, actor) : host.ctx.board.followPage(address, actor)).catch((e: Error) => { throw new ActionRefused(`no page ${address}: ${e.message}`); });
  if (!made.note) throw new ActionRefused(made.status === "deleted" ? `[[${address}]] is a page in the trash: restore it there` : `no page ${address}`);
  const said = made.created ? `created page ${subject(made.note)} ${made.placement?.said ?? ""}`.trim() : `${subject(made.note)} was there already`;
  if (standing) {
    r.shown(made.note, host, { link: true, by: actor, standing });
    host.ctx.flash(said);
  }
  host.redraw();
  // One there already was opened, not written.
  return { id: made.note.id, created: made.created, said, ...(made.created ? { recordedAs: recordedAnswer(actor, "new") } : {}) };
}
