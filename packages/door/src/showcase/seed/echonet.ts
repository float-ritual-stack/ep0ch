// The showcase seed's echonet (split out of seed.ts): its notes' text and fixtures. Exported through ../seed.ts as before.
import { type Actor } from "../../socket";
import { SEED } from "./names";

/** EchoNet's mini network (PIE-779): Plot chat's posts, Seed swap's copies, the nodelist's entries. */
export const ECHO_TOSSER = { kind: "agent", id: "echo-tosser" } as const satisfies Actor;

export const ECHO_POSTS = [["Hosepipe ban from Monday", "Water cans only; the butts are full.", "ana"], ["Who has the long ladder?", "The shed gutter wants clearing before the rain.", "ravi"]] as const;

export const copyOf = (n: number, title: string, body: string, by: string, more = "") =>
  `${title} [from::society@box-a/5eed5a90-0000-4000-8000-00000000000${n}] [echo::seed.swap] [from-rev::1] [tossed::2026-03-0${n}T09:30:00Z] [by::${by}]${more}\n${body}`;

export const ECHO_COPIES = [
  copyOf(1, "Runner beans to swap", "Two jars of Scarlet Emperor. Swap for any squash.", "june"),
  copyOf(2, "Tomato seed, saved last year", "Gardener's Delight, dried on kitchen paper.\nAsk before the end of March.", "ravi", " [upstream-newer::2]"),
  copyOf(3, "Swap table on Saturday", "By the water trough from ten. Bring labels.", "ana", " [upstream-gone::2026-03-04]"),
];

/** The nodelist as the tosser writes it (a section per node) and its toss logs under it. */
export const ECHO_NODELIST = [
  `${SEED.nodelist} [type::nodelist] [machine::echonet] [node::kitchen@box-b] [last-toss::2026-03-03T09:31:00Z]`, "",
  "The nodes this outline knows, written again by EchoNet's tosser at every toss.", "",
  "## kitchen@box-b", "- this node", "- last toss: 2026-03-03T09:31:00Z", "- areas: plot.chat (Plot chat)", "- subscriptions: seed.swap from society@box-a", "",
  "## society@box-a", "- reachable · we read its seed.swap", "- last toss: 2026-03-03T09:30:00Z", "- areas: seed.swap (Seed swap)", "- subscriptions: plot.chat from kitchen@box-b", "",
  "## attic@box-c", "- unreachable: no forward to box-c · reads our areas", "- last toss: unknown", "- areas: unknown", "- subscriptions: unknown", "",
  // A machine that dials in (a laptop whose inbound ssh is off): never down, its last call and the netmail held for it.
  "## shed@box-d", "- dials in · last call 2026-03-03 08:12 UTC · reads our areas", "- netmail held: 1 (its next call takes it)", "- last toss: 2026-03-03T08:12:00Z", "- areas: unknown", "- subscriptions: unknown",
].join("\n");

export const ECHO_TOSSES = [
  "Toss 2026-03-02 09:30 UTC [type::toss] [machine::echonet] [node::kitchen@box-b] [at::2026-03-02T09:30:00Z] [copies::2] [updated::0] [skipped::0] [netmail-out::0] [netmail-in::0] [queued::0]",
  "Toss 2026-03-03 09:31 UTC [type::toss] [machine::echonet] [node::kitchen@box-b] [at::2026-03-03T09:31:00Z] [copies::1] [updated::1] [skipped::0] [netmail-out::1] [netmail-in::1] [queued::1]",
];

/** The nodes that read Plot chat: the seen-by marks the tosser leaves on each of its posts. */
export const ECHO_SEEN_BY = ["society@box-a", "attic@box-c"] as const;
