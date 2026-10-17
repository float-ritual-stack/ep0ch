// The showcase seed's extensions (split out of seed.ts): its notes' text and fixtures. Exported through ../seed.ts as before.
import { type SocketBoard } from "../../socket";
import { installTickets, refreshTicket, registerTicket, SHOWCASE_TICKETS, ticketSource } from "../tickets/install";
import { SEED } from "./names";

/** Two notes with different forms (PIE-828): each says its own fields; the Form extension's one action asks for them. */
export const FORM_READING = [
  SEED.formReading,
  "What the plot's book club read over the winter. Fill in the form (the power bar: Fill in the form, or act ext.form.fill) and each book lands under this note with its answers as properties.",
  "",
  "The form: [form-field::book text required] [form-field::pages number] [form-field::mood choice gripping|slow|abandoned default=slow]",
].join("\n");

export const FORM_REPAIRS = [
  SEED.formRepairs,
  "The same action, another form: this note asks which part, what's wrong and whether it's urgent.",
  "",
  "The form: [form-field::part choice door|roof|window|gutter required] [form-field::what text required] [form-field::urgent choice yes|no default=no]",
].join("\n");

/**
 * Resource projections (PIE-445): a call that names made-up tickets. Under each `jira::` line a reader
 * shows the ticket the line above names: a fetched one, a registered one not fetched yet (compact), two keys
 * on one line (ambiguous) and one never registered. Its child is a ticket page, shown at its top.
 */
export const TICKETS = [
  SEED.tickets,
  "What we agreed about switching the depot's supplier.",
  "jira::",
  "The label printer problem is ACME-14.",
  "jira:: --compact",
  "Either ACME-20 or ACME-21 covers the invoices; check which.",
  "jira::",
  "ACME-30 came up at the end.",
  "jira::",
].join("\n");

export const TICKET_PAGE = "Rollout ticket [jira::ACME-12]\nOur own notes under the ticket: book the van for the 14th.\njira:: --comments";

/**
 * The tickets' Source and Resources. With `ticketsConfig` (the service's XDG_CONFIG_HOME) the made-up
 * ticket extension is installed there and ACME-12 is fetched through it; without it both are only
 * registered. Nothing contacts a real provider.
 */
export async function seedTickets(board: SocketBoard, ticketsConfig?: string) {
  const sourceId = await ticketSource(board);
  if (!ticketsConfig) {
    for (const [key, t] of Object.entries(SHOWCASE_TICKETS)) await board.request("resources.intern", { input: { sourceId, address: { kind: "ext:jira", entityId: t.id, key } } });
    return;
  }
  installTickets(ticketsConfig, SHOWCASE_TICKETS);
  const ready = await registerTicket(board, "ACME-12");
  await registerTicket(board, "ACME-14");
  await refreshTicket(board, ready);
}

/** A cap-held ask: the preceding automatic wake spent this writer's daily allowance. */
export const HELD_ASK = ["Reply to the seed swap thread", "*  thanks   for   the  leeks", "@tidy"].join("\n");

/**
 * The four extension kinds (PIE-507, drawn by the door since PIE-512): a record (`moon::`), an inline output
 * (`horoscope::`), a rich component (`fancy-horror::`, its `w` wards an omen) and an `@tidy` request that
 * tidies the line above it. With the outliner's examples installed they run; without, they are properties.
 */
export const OMENS = [
  SEED.omens,
  "moon:: 2026-10-26",
  "horoscope:: virgo",
  "fancy-horror:: virgo",
  "",
  "water   the  leeks  before   noon",
  "@tidy",
].join("\n");

/**
 * Rules (PIE-600): a meeting the outliner's `meeting-card` rule draws a card over (it matches `[type::meeting]`), its
 * `## ` headings drawn as bands by a rule note under it (no code), and a line `shout` draws as a band in its place.
 * Under it, the rule note and a job `done-stamp` stamps when its status becomes done.
 */
/** Where the almanac extension writes each morning's note (ext.almanac.write-day, by act or on its 06:05 schedule). */
export const ALMANAC = [
  `${SEED.almanac} [page::almanac]`,
  "",
  "Each morning at 06:05 the almanac extension writes a dated note here, as ext:almanac, over its own connection to the",
  "service. Run it now: act ext.almanac.write-day (once a day; again says it's there).",
].join("\n");

export const RULES_NOTE = [
  `${SEED.rules} [type::meeting] [when::Sat 10:00] [where::the shed] [attendees::Ann, Bo, Cy]`,
  "",
  "The committee meets in the shed. The rules in this outline draw on this note, and its text is only what you see with R:",
  "the card above is meeting-card's (it matches the meeting's type), the bands are a rule note's under it (no code), and",
  "the last line is shout's.",
  "",
  "## Agenda",
  "- Water rota for August",
  "- Who keeps the shed key",
  "",
  "## Actions",
  "- [ ] Order the new hose",
  "",
  "Close the cold frame tonight!!!",
].join("\n");
