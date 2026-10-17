// The showcase seed's margin (split out of seed.ts): its notes' text and fixtures. Exported through ../seed.ts as before.
import { join } from "node:path";
import { recentRepliesView } from "@ep0ch/outline-core/recent-replies";
import { SEED } from "./names";
import { SHOWCASE_ASSETS } from "./media";

/** The remote client the showcase's remote writes come from (PIE-615), and the line its patch proposes to change. */
export const REMOTE_CLIENT = { sub: "user_showcase", clientId: "https://chat.example.test/oauth/client-metadata" } as const;

export const REMOTE_LINE = "Bought two bags of compost for the beds.";

export const REMOTE_WRITES = [
  SEED.remoteWrites,
  "",
  "A conversation on claude.ai, or on the phone, can write here through the remote MCP gateway (`ep0ch mcp serve --http`), as far as this outline's access lets it: `ep0ch mcp access propose` takes proposals, `full` applies writes against the revision they read, and `read` takes none. Each write is an agent's, and says two things: the principal that auth proved (the OAuth client, `claude.ai`; or the client on the machine for stdio and the Claude mod, `claude-code@float-2`) and, on top, the persona it declared (`OUTLINER_ACTOR`, the folder's `.ep0ch` `agent`, `EP0CH_MCP_PERSONAS`): `loki (claude-code@float-2)`. A persona is a recorded name, never a permission; the principal beside it says where the write came from. The door says it on its status line as it lands.",
  "",
  "An agent can also make a place of its own for the fleeting things (a link spree, the day's discourse) with `outline_new`: it is made on this machine, the agent gets `full` on it and the other principals `read`, its root note carries `[created-by::…] [purpose::…] [kind::scratch]`, and the door's home base and `ep0ch outline list` show who made it and why. `ep0ch outline archive <name>` (or `outline_archive`) puts it away and keeps the database; nothing deletes over MCP.",
  "",
  "At `propose`, the patch below became a proposal under this note (apply it anyway, or dismiss it), and a comment started a thread:",
  "",
  REMOTE_LINE,
  "",
  "An outline whose home is another machine (the laptop's) is read from a mirror here, and its writes never touch the mirror. They wait in the netmail queue on the gateway's machine until that machine dials in: its backup job pulls them every fifteen minutes while it's online (or `ep0ch mcp pull` does it now), applies each one, and a note that changed meanwhile gets a proposal, never an overwrite.",
  "",
  "Where the queue shows:",
  "- `ep0ch mcp queue status` on the gateway's machine: how many writes wait for each machine, the oldest, its last pull, and what the latest ones became",
  "- `list_outlines`, the MCP tool: a mirrored outline's `writes: queued` and its `queue`",
  "- `outline_write_status`, the MCP tool: one queued write by its `queueId` (queued with the machine's last pull, applied with its revision, proposed with the proposal's URI, superseded, or rejected with why); and `outline_read` lays the caller's own still-queued edits over the mirror's text, fenced as pending",
  "- `ep0ch doctor` and `ep0ch backup status`: a netmail line for each machine, and on the home machine its last pull",
  "- the door's status bar: an alert once writes have waited a day while their machine was online",
].join("\n");

/**
 * The files a made-up Claude session touched (PIE-602), as the Claude mod files them: under the day, the project and
 * the session, one block per file with its touches and lines; `[file::]` opens the file (the showcase's own assets).
 */
export const recentFilesText = () => [
  SEED.recentFiles,
  "",
  "A Claude session in a door edited two files in the allotment folder. The Claude mod filed each one as it was touched, as it files every Edit and Write in the outline its folder names: under the day, the project and the session, one block per file, its count, last time and lines brought up to date on each touch (the outliner's `agent touch-file`). The real ones live under [[recent-files]]; By project there has one view per project, newest first.",
  "",
  "Open a file from its block's `[file::]` link (the file Resource reader), or from the Edit row in Claude: `ep0ch open file:<path>` puts it where opens land, Markdown drawn as the preview draws it; `diff=true` shows its changes.",
].join("\n");

export const RECENT_FILES = (dir = SHOWCASE_ASSETS) => [
  { file: join(dir, "bed-plan.md"), shown: "bed-plan.md", touches: 3, at: "2026-03-11T09:42:00.000Z", added: 6, removed: 2 },
  { file: join(dir, "seed-list.txt"), shown: "seed-list.txt", touches: 1, at: "2026-03-11T09:31:00.000Z", added: 4, removed: 0 },
];

export const RECENT_SESSION = "7c1e2f30-5a4b-4c3d-9e8f-0a1b2c3d4e5f";

/** The file marginalia reads beside the plan (a made-up leaflet): a Resource, highlighted and asked about like a note. */
export const MARGINALIA_FILE = (dir = SHOWCASE_ASSETS) => join(dir, "cold-frame-guide.md");

/**
 * Marginalia's plan note (ADR 0004 contracts 5 and 6, PIE-751, PIE-753): a made-up greenhouse plan with a glossary (what
 * marginalia's Define reads), a fragment anchor (what Cite cites) and the leaflet it's read beside.
 */
export const MARGINALIA_PLAN = (file = MARGINALIA_FILE()) => [
  SEED.marginalia,
  "",
  "Select any words, then a (or click a chip on the selection's line): h highlight, c comment, a ask @margin, e explain, d define, k cite. M cycles shown, full and marks. Click [–] on a card to fold it to its gutter [+]; click [+] to open just that thread.",
  "",
  "Water the tomatoes at dawn, before the glass warms. ^water",
  "Keep the soil pH near 6.5 for the peppers; the chillies want it a touch lower.",
  "Move the leeks to the cold frame in the second week of March, and harden them off for ten days.",
  "Sow the basil only once the nights stay above ten degrees.",
  "",
  `Read beside it: [file::${file}]`,
  "",
  "## Glossary",
  "- **soil pH**: how acid or sweet the soil is, from 0 to 14; 7 is neutral.",
  "- cold frame — a low glass box that hardens seedlings off.",
  "- harden off: get a seedling used to the weather a little more each day.",
].join("\n");

/** The notebook: a saved query over every annotation (properties are open: kind, tags, colour as written), in outline order, so each note's sit together. */
/** Recent replies (Conversations in the margin): the saved view, the same question the web client's /replies page asks. */
export const RECENT_REPLIES = `${recentRepliesView(SEED.recentReplies)}\nEvery reply on a thread you started or wrote in, newest first. Opening a thread (a click on its card or mark, or the web client's link) marks it read; unread:me narrows to the new ones.`;

export const MARGINALIA_NOTEBOOK = `${SEED.marginaliaNotebook} [type::virtual-branch] [query::type=annotation] [summary-properties::kind,tags]\nEvery highlight, comment and answer, grouped under the note it's on. ep0ch export --view <this note's id> writes them out.`;
