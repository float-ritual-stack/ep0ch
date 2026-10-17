import { blockTags, metadataLines } from "@ep0ch/outline-core/block-tags";
import { linkOccurrences } from "@ep0ch/outline-core/link-syntax";
import { buttonCallAt } from "@ep0ch/outline-core/button-call";
import { closeOpenFences, noteCodeFences } from "@ep0ch/outline-core/component-block";
import type { Decoration } from "./extension-rules";
import type { ResourceProjection, ResourceProjectionReadResult } from "./resource-projection";
import { COMPONENT_STYLE, componentSentinel, drawComponents, drawnLine, hasResult, isComponentSentinel, lineSource, MAX_PUBLISHED_COMPONENTS, readBlockdown, readImages } from "./publish-components";
import { boardHtml, FIGURE_STYLE, viewRowsHtml } from "./publish-figures";
import { drawNoteComponents, drawViewLane, readViewLane, type DrawnComponent, type LiveHost } from "./publish-live";
import { publishedValueWords, readPageValues } from "./publish-values";
import { substituteValues } from "@ep0ch/outline-core/site-values";
import type { SiteValue } from "@ep0ch/outline-core/site";
import { ARTIFACT_PATH, drawNoteMedia, fileName, MEDIA_PATH, MEDIA_STYLE, mediaHtml, mediaMarkdown, mediaPath, noteMediaLines } from "./publish-media";
import { artifactKind, artifactPagePath, artifactTitle, imagePrimitiveSpec, MEDIA_ATTRS, type MediaSpec } from "@ep0ch/outline-core/media-line";
import { validatePrimitive, viewImages } from "./component-primitives";
import { isVirtualBranchDefinition } from "./virtual-branches";
import { hostname, networkInterfaces } from "node:os";
import { extname } from "node:path";
import { Marked } from "marked";
import { blockdownMarked } from "./blockdown-marked";
import type { OutlinerClient, OutlinerWatcher } from "./client";
import type { ShareSession, WebSession } from "@ep0ch/outline-core/protocol";
import type { ShareResolution } from "./share-sessions";
import type { WebDoor } from "./publish-door";
import { ShareTunnels } from "./publish-tunnels";
import type { FileContents } from "./files";
import { MAX_TEXT_FILE_BYTES } from "./files";
import { pageAddressReferences, pageAddressText, tryNormalizePageAddress } from "@ep0ch/outline-core/link-syntax";
import { getProperty } from "./properties";
import { parseProperties, parsePropertyRecords, stripPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { workIdTitle } from "@ep0ch/outline-core/work-id-title";
import {
  canonicalPublishRoots,
  checkAttachment,
  checkImage,
  readCheckedImage,
  type AttachmentPolicy,
  type PublishedFileType,
} from "./publish-attachments";
import { calloutExtension, CALLOUT_STYLE, publishedCalloutRegistry } from "./publish-callouts";
import { BUILTIN_CALLOUT_REGISTRY, type CalloutRegistry, type CalloutType } from "@ep0ch/outline-core/callouts";
import { ArtifactCompiler, mermaidArtifactPage, reactArtifactPage } from "./publish-artifacts";
import { drawMarginalia, MARGINALIA_STYLE, MAX_PUBLISHED_MARKS, placeMarkSentinels, plainBody, publishedAnnotations, type PublishedAnnotation } from "./publish-marginalia";
import { drawAnchors, lineAddresses, placeAnchor, replacementAddresses } from "./publish-anchors";
import { drawSteps, placeStepSentinels, STEP_MENU_STYLE, STEP_STYLE, type PublishedStep } from "./publish-steps";
import { PAGE_ROUTE, PageMarginalia, readerScriptPath, webmcpScriptPath, sameOrigin, type PageShare, type PageView } from "./publish-page";
import { completeAt, SEARCH_STYLE, searchForm, searchNotes, searchResultsHtml, searchScriptPath, summaryWords, type SearchHost } from "./publish-search";
import { ANNOTATION_REPLY_TYPE, ANNOTATION_TYPE, extractAnnotationBody } from "./annotations";
import { RECENT_REPLIES_QUERY, UNREAD_REPLIES_QUERY } from "@ep0ch/outline-core/recent-replies";
import { markTitleLine } from "@ep0ch/outline-core/annotation-marks";
import { blockReferenceOccurrences } from "@ep0ch/outline-core/link-syntax";
import { MAX_BLOCK_READ_IDS } from "./block-projection";
import { codeLineSet, stripFragmentAnchors } from "./fragments";
import { embedMatches, MAX_EMBEDS_PER_DOCUMENT, TRANSCLUSION_WORDING, type TransclusionNode, type TransclusionRead } from "./transclusions";
import { actorName } from "@ep0ch/outline-core/attribution";
import type {
  AnnotationThread,
  Block,
  BlockProperty,
  BlockReadCollection,
  GotoSearchCollection,
  OutlinerServiceStatus,
  PageAddressResolution,
  ProjectedBlock,
  ProjectedBlockCollection,
  PublisherAddress,
  NotePublication,
  RenderedNote,
  ProjectedVisibleBlock,
} from "./types";

/**
 * Outline as server: an HTTP publisher for blocks carrying `[publish::…]`, and on
 * the tailnet a light web client for the whole outline (PIE-782): every note is a
 * page, a folder that is also a file. It is a client of the service (blocks.query,
 * children, files.read, the content event feed). It writes only one way: marginalia
 * from a tailnet page (`<base>/_marginalia/write`, publish-page.ts), through the
 * service's own annotation and passage-action paths; being on the tailnet is the
 * sign-in. The public listener writes only below a share link that takes comments
 * (`/s/<token>/`, share-sessions.ts), the link being the sign-in, checked with the
 * service on every request. See README "Publishing blocks" and "Share links".
 */

export const PUBLISH_PROPERTY = "publish";
export const PUBLISH_QUERY_LIMIT = 1000;
const INDEX_MAX_AGE_MS = 5_000;
const DISCONNECTED_MAX_AGE_MS = 1_000;
/** At most this many distinct `[[page]]` addresses are resolved for one page; the rest show their label. */
const PAGE_RESOLVE_LIMIT = 200;
/** `pages.resolve` requests in flight at once, so one large page never floods the shared service. */
const PAGE_RESOLVE_CONCURRENCY = 4;
/** Levels the `[publish::never]` lock is looked for above a block; a deeper chain counts as locked. */
const LOCK_WALK_LIMIT = 256;
/** A crumb names at most this many notes above, as `tree.search` does (search-context.ts `ancestorPath`). */
const CRUMB_LEVELS = 12;

export type PublishedEntryType = PublishedFileType | "block";

/**
 * Who a listener serves. `tailnet`: every published note, the index, embeds of
 * any note. `public` (`[publish::public]`, for anyone with the link, exposed by
 * Tailscale Funnel): only notes tagged public, no index, and an embed of a note
 * that isn't public shows a placeholder, never its text.
 */
export type PublishAudience = "tailnet" | "public";

export interface PublishedEntry {
  blockId: string;
  title: string;
  /** URL path below the base path, e.g. `/p/moth-garden`. */
  path: string;
  slug: string;
  /** The slug the block asked for when another block holds it. */
  collision?: { requested: string; heldBy: string };
  type: PublishedEntryType;
  updatedAt: string;
  /**
   * Set when the block is `[publish::public…]`: anyone with the link may open it
   * on the public listener, at `publicPath`. Its title there links only public notes.
   */
  public?: { title: string };
  /**
   * Set when the block has `[file::…]`: the path as authored and why it is not
   * served, if not. Over HTTP only a refusal is shown, never the path.
   */
  attachment?: { source?: string; refused?: string };
}

export interface PublishedIndex {
  entries: PublishedEntry[];
  truncated: boolean;
  builtAt: string;
  /** Links to published notes are their labels (a note rendered for elsewhere with no publisher URL to link to). */
  labelsOnly?: boolean;
  /** A `#tag` links to the notes carrying it (`<base>/search?q=%23tag`, PIE-800): only where a search is served, a tailnet page or a share's. */
  tagSearch?: boolean;
}

/**
 * What the publisher asks of the service: a socket client (`publish serve`), or the service itself in-process, which
 * only answers requests (`Publisher.inService`: `notes.render` and `notes.address`, PIE-767).
 */
export type PublishClient = Pick<OutlinerClient, "request"> & Partial<Pick<OutlinerClient, "requireCompatibleService" | "watch">>;

export interface PublisherOptions {
  tailnetUrl?: string;
  client: PublishClient;
  /** Extra allowed attachment roots; the outline's workspace root is always one. */
  roots?: readonly string[];
  /** Leave the workspace root out of the allowlist (tests, or an outline rooted too broadly). */
  excludeWorkspaceRoot?: boolean;
  maxBytes?: number;
  /** Where a proxy mounts the publisher (`/pub`); links carry it and requests may too. */
  basePath?: string;
  /**
   * Host names requests may name besides loopback and `*.ts.net` (the tailnet
   * names `tailscale serve` forwards). Any other Host is refused, so a web page
   * that rebinds its own name to 127.0.0.1 cannot read what is published.
   */
  allowedHosts?: readonly string[];
  /**
   * Where React artifacts' packages and compiled bundles are cached
   * (`<state root>/publish/artifacts` from the CLI). Without it a `.jsx`/`.tsx`
   * attachment shows a page saying compiling is not set up.
   */
  artifactCacheDirectory?: string;
  /**
   * Where the public listener is mounted (`/share`), or the full URL anyone opens
   * it at (`https://host.ts.net:8443/share`): its path is the base path, and the
   * whole URL is what the index and `publish list` show for public notes.
   */
  publicUrl?: string;
  /**
   * The full URL the tailnet listener is opened at, base path included (`--url`, OUTLINER_PUBLISH_URL:
   * `https://host.ts.net/pub`). The publisher tells the service, so `notes.address` can give a published note's web URL.
   */
  url?: string;
  /**
   * Run `cloudflare` shares' tunnels (publish-tunnels.ts), each to a loopback ingress of its own, and tell the
   * service so. A serving publisher with a public listener does.
   */
  tunnels?: boolean;
  /** How often the tunnels read the share list again (tests shorten it). */
  tunnelSweepMs?: number;
  /** cloudflared's path (tests give a fake); else EP0CH_CLOUDFLARED, else PATH. */
  cloudflared?: () => string | undefined;
  /**
   * The web client's root, where the home outline is mounted (`/pub`): an outline's folder links its fellow outlines
   * at `<webRoot>/o/` (publish-outlines.ts). Defaults to the base path.
   */
  webRoot?: string;
  /**
   * Where the outline is served from, said at the top of its pages instead of its bare name: another machine's outline
   * (publish-remote.ts), `float-hub · laptop · live` or `… · as of <time> (laptop asleep)`.
   */
  provenance?: () => string;
  /**
   * Why the page takes no writes now (a read-only copy, its MCP access): no write controls, and writes refused. Null: it
   * takes them. `fresh`: a write is about to land, so nothing remembered from earlier answers.
   */
  writes?: (fresh: boolean) => Promise<string | null>;
  /** Tell the service who reads which page (`reader.report`); a read-only copy can't keep it. Default true. */
  presence?: boolean;
  /** Offer `share…` on a note's page (the shares page starts it); a publisher with no public listener of its own doesn't. Default true. */
  shares?: boolean;
  /**
   * The door in the browser (publish-door.ts): `<base>/door` on the tailnet listener and at the signed-in origin for a
   * live web session, and a `door` link in each such note's footer. Never on the public listener or a share link.
   */
  door?: WebDoor;
  log?: (line: string) => void;
}

/** A request the sign-in listener let through (web-signin.ts): which web session it came with. */
export interface SignedIn {
  sessionId: string;
  /** Whether that session is still live now (not signed out, revoked, expired or taken off the list): a long answer asks again. */
  stillSignedIn?: () => Promise<boolean>;
}

/** What a block's `[publish::…]` asks for: not published, locked, or published (public or tailnet only), maybe at a slug. */
export type PublishIntent = "off" | "never" | { slug?: string; public: boolean };

/**
 * `true`/`yes` publish at the page address or block id; `<slug>` at that slug;
 * `public` and `public:<slug>` do the same and also open the note to anyone
 * with the link; `false`/`no`/`off`/`0` or empty do not publish; `never` locks
 * the block and everything under it (see `blockPublishIntent`).
 */
export function publishIntent(value: string | undefined): PublishIntent {
  let trimmed = value?.trim() ?? "";
  const lowered = trimmed.toLowerCase();
  if (lowered === "never") return "never";
  if (!trimmed || lowered === "false" || lowered === "no" || lowered === "off" || lowered === "0") return "off";
  const isPublic = lowered === "public" || lowered.startsWith("public:");
  if (isPublic) trimmed = trimmed.slice("public".length).replace(/^:/, "").trim();
  const lowerRest = trimmed.toLowerCase();
  // `public:false` or `public:never` is never read as a slug that opens the note to everyone.
  if (isPublic && lowerRest === "never") return "never";
  if (isPublic && (lowerRest === "false" || lowerRest === "no" || lowerRest === "off" || lowerRest === "0")) return "off";
  if (!trimmed || lowerRest === "true" || lowerRest === "yes") return { public: isPublic };
  const slug = slugify(trimmed);
  return slug ? { slug, public: isPublic } : { public: isPublic };
}

/**
 * A URL path from authored text: NFKC, lower case, `/` separates folders,
 * anything but letters, digits, `.`, `_`, `~` and `-` becomes `-`. Segments
 * never start or end with `.` or `-`, so `.` and `..` cannot appear.
 */
export function slugify(value: string): string | null {
  const segments = value
    .normalize("NFKC")
    .toLowerCase()
    .split("/")
    .map((segment) => segment
      .trim()
      .replace(/[^\p{L}\p{N}._~-]+/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, ""))
    .filter(Boolean);
  const slug = segments.join("/").slice(0, 200).replace(/[/.-]+$/, "");
  return slug || null;
}

/**
 * A block's publish intent from all its `[publish::…]` tokens. `never` wins
 * over everything: the block and its whole subtree are locked, never published,
 * embedded or linked. Otherwise, when any says false/no/off/0 the block is not
 * published, whatever the others say. The first slug asked for is used, and
 * the block is public when any token says `public`.
 */
export function blockPublishIntent(properties: readonly BlockProperty[]): PublishIntent | undefined {
  const values = properties.filter((property) => property.key === PUBLISH_PROPERTY).map((property) => publishIntent(property.value));
  if (!values.length) return undefined;
  if (values.includes("never")) return "never";
  if (values.includes("off")) return "off";
  const published = values.filter((value): value is Exclude<PublishIntent, string> => typeof value === "object");
  const slug = published.find((value) => value.slug)?.slug;
  return { ...(slug ? { slug } : {}), public: published.some((value) => value.public) };
}

/** `[publish.ext::jira]` on a block or page lets that extension's blocks under it be published. */
export const PUBLISH_EXTENSION_PROPERTY = "publish.ext";

/**
 * The extension whose data a block holds: its writer is `ext:<id>` (an
 * extension record, such as a Jira ticket kept as a block). Real blocks go
 * wherever the outline goes, so these are left off a published page unless
 * the block or a block above it opts in with `[publish.ext::<id>]` (or `all`).
 */
export function extensionSource(block: { author?: string; actorId?: string }): string | undefined {
  return block.author === "agent" && block.actorId?.startsWith("ext:") ? block.actorId.slice(4) || undefined : undefined;
}

/** Whether these properties opt an extension's blocks in. */
export function publishesExtension(properties: readonly BlockProperty[], extensionId: string): boolean {
  return properties.some((property) => property.key === PUBLISH_EXTENSION_PROPERTY &&
    property.value.split(/[\s,]+/).some((value) => {
      const lowered = value.trim().toLowerCase();
      return lowered === extensionId || lowered === "all" || lowered === "true";
    }));
}

/** What an extension's block shows in its place when it isn't opted in. */
export const EXTENSION_HIDDEN = (extensionId: string) => `${extensionId} data, not published (add [publish.ext::${extensionId}] to publish it)`;

/** Said on the index: what a published page may show besides the published blocks. */
export const EMBED_NOTICE = "Embeds (!((note))) show the embedded note's text even when that note is not published: " +
  "this publisher is for the tailnet. Mark a note [publish::never] to lock it and everything under it. " +
  "A note marked [publish::public] is also open to anyone with its public link, where embeds show only public notes.";

/** What a locked note shows in its place on a published page. */
export const LOCKED_NOTE = "locked note";

/** What an embed of a note that isn't public shows in its place on a public page. */
export const NOT_SHARED_NOTE = "not shared";

function requestedSlug(block: { id: string; properties?: BlockProperty[] }): string | null {
  const intent = blockPublishIntent(block.properties ?? []) ?? "off";
  if (intent === "off" || intent === "never") return null;
  if (intent.slug) return intent.slug;
  const page = getProperty(block.properties ?? [], "page");
  const address = page ? tryNormalizePageAddress(page) : null;
  return (address && slugify(address.displayAddress)) || block.id;
}

/**
 * Assigns each published block its path. When blocks ask for the same slug the
 * oldest (created first, then lowest id) keeps it; each other gets
 * `<slug>~<first 8 of its id>` and the index shows the collision.
 */
export function assignPaths(blocks: readonly ProjectedVisibleBlock[]): Array<{ block: ProjectedVisibleBlock; slug: string; collision?: PublishedEntry["collision"] }> {
  const wanted = blocks
    .map((block) => ({ block, slug: requestedSlug(block) }))
    .filter((entry): entry is { block: ProjectedVisibleBlock; slug: string } => entry.slug !== null)
    .sort((left, right) =>
      (left.block.createdAt ?? "").localeCompare(right.block.createdAt ?? "") || left.block.id.localeCompare(right.block.id));
  const holders = new Map<string, string>();
  return wanted.map(({ block, slug }) => {
    const holder = holders.get(slug);
    if (holder === undefined) {
      holders.set(slug, block.id);
      return { block, slug };
    }
    const alternate = `${slug}~${block.id.slice(0, 8)}`;
    holders.set(alternate, block.id);
    return { block, slug: alternate, collision: { requested: slug, heldBy: holder } };
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const SAFE_HREF = /^(?:https?:|mailto:|\/|#|\.{0,2}\/|[^:]*$)/i;

/** Markdown to HTML with authored raw HTML shown as text and only safe link schemes. */
const markdownRenderer: Marked = new Marked({
  ...blockdownMarked,
  gfm: true,
  // A callout (`> [!type] Title`) is a box; any other quote stays a quote.
  extensions: [calloutExtension(() => activeCallouts)],
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!SAFE_HREF.test(href)) return label;
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${label}</a>`;
    },
    image({ href, title, text }) {
      if (!SAFE_HREF.test(href)) return escapeHtml(text);
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
    },
  },
});

/** The callout types the render in progress draws with (parsing is synchronous, so one at a time). */
let activeCallouts: CalloutRegistry = BUILTIN_CALLOUT_REGISTRY;

/** Markdown as the page's HTML; `callouts` are the outline's types (the built-ins when none are given). */
/**
 * A page's title heading in the accent where it starts with a Work ID (PIE-809: `HOME-011 · <title>`, as
 * renderSubtreeMarkdown heads a note that has one): the Work ID in its own span, the page's first heading only.
 */
export function accentWorkId(html: string): string {
  return html.replace(/(<h1\b[^>]*>(?:<a\b[^>]*><\/a>)?)([A-Za-z][A-Za-z0-9]*-\d+)( · )/, `$1<span class="wid">$2</span>$3`);
}

/** One line of Markdown as inline HTML (no paragraph around it): a figure row's words (PIE-864). */
export function renderInlineHtml(markdown: string): string {
  return markdownRenderer.parseInline(markdown, { async: false }) as string;
}

export function renderMarkdownHtml(markdown: string, callouts: CalloutRegistry = BUILTIN_CALLOUT_REGISTRY): string {
  const before = activeCallouts;
  activeCallouts = callouts;
  // A fence left open ends at its paragraph, as the service reads it (PIE-669), not at the page's end.
  try { return markdownRenderer.parse(closeOpenFences(markdown), { async: false }) as string; } finally { activeCallouts = before; }
}

const PAGE_STYLE = `
h1 .wid{color:var(--link);white-space:nowrap}
:root{color-scheme:dark;--bg:#111110;--fg:#e8e6df;--dim:#9a988f;--rule:#34332f;--link:#8fb8ff}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 ui-serif,Georgia,serif}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 4rem}
a{color:var(--link)}
header.bar,footer{font:13px/1.5 ui-monospace,Menlo,monospace;color:var(--dim)}
header.bar{border-bottom:1px solid var(--rule);padding-bottom:.5rem;margin-bottom:1.5rem}
footer{border-top:1px solid var(--rule);margin-top:3rem;padding-top:.5rem}
pre,code{font:14px/1.45 ui-monospace,Menlo,monospace}
pre{overflow-x:auto;padding:.75rem;border:1px solid var(--rule)}
table{border-collapse:collapse;font:14px/1.5 ui-monospace,Menlo,monospace;display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
th,td{text-align:left;padding:.25rem .75rem .25rem 0;border-bottom:1px solid var(--rule);vertical-align:top;min-width:7em;overflow-wrap:normal}
th{color:var(--dim);font-weight:normal}
.dim{color:var(--dim)}
img{max-width:100%}
input[type=checkbox]{appearance:none;-webkit-appearance:none;width:.85em;height:.85em;margin:0 .45em 0 0;vertical-align:-.05em;border:1px solid var(--dim);border-radius:.15em}
input[type=checkbox]:checked{background:var(--link);border-color:var(--link);box-shadow:inset 0 0 0 2px var(--bg)}
${CALLOUT_STYLE}${COMPONENT_STYLE}${FIGURE_STYLE}${MARGINALIA_STYLE}${MEDIA_STYLE}${STEP_STYLE}`;

/**
 * A tailnet page (PIE-782): phone first, a reading measure, targets a thumb can hit, and dark throughout. Evan is
 * photosensitive: no transitions, no light surfaces, nothing that flashes. Margin cards sit beside the text when the
 * window is wide and under their passage when it's narrow (publish-reader.js places them).
 */
const BROWSE_STYLE = `${STEP_MENU_STYLE}
main.browse{max-width:42rem;padding:1rem 1rem 6rem}
nav.crumbs{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--dim);border-bottom:1px solid var(--rule);padding-bottom:.4rem;margin-bottom:1.25rem;overflow-wrap:anywhere}
nav.crumbs a{color:var(--dim);text-decoration:none;display:inline-block;padding:.45rem 0}
nav.crumbs a:hover{color:var(--fg)}
main.browse article{overflow-wrap:anywhere}
section.inside h2{font:600 12px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:2.5rem 0 .4rem}
ul.kids{list-style:none;margin:0;padding:0;border-top:1px solid var(--rule)}
ul.kids li{border-bottom:1px solid var(--rule)}
ul.kids li>a{display:block;padding:.75rem .35rem;min-height:2.75rem;text-decoration:none;color:var(--fg)}
ul.kids li>a:hover,ul.kids li>a:active{background:#18181a}
ul.kids li>a:has(+.m){padding-bottom:0;min-height:0}
ul.kids li>.m{padding:0 .35rem .75rem}
ul.kids .m a{color:var(--link)}
ul.kids .t{display:block;color:var(--link)}
ul.kids .s{display:block;color:#c9c7bf;font-size:15px;line-height:1.45;margin-top:.15rem}
ul.kids .m{display:block;font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--dim);margin-top:.2rem;overflow-wrap:anywhere}
ul.kids li.locked{padding:.75rem .35rem;color:var(--dim);font-style:italic}
ul.replies li.new .t{color:var(--fg);font-weight:600}
ul.replies .dot{color:var(--link);font-size:.8em}
::selection{background:#3b4250;color:inherit}
main.browse [hidden],.mg-ui[hidden]{display:none!important}
.mg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.shares td form{margin:0}
.shares button,.share-new button{font:14px/1 ui-sans-serif,system-ui,sans-serif;min-height:40px;padding:0 .8rem;border-radius:.4rem;border:1px solid var(--rule);background:#222220;color:var(--fg);cursor:pointer}
.share-new label{display:block;margin:.5rem 0}
.share-new select,.share-new input{font:15px ui-sans-serif,system-ui,sans-serif;background:#111110;color:var(--fg);border:1px solid var(--rule);border-radius:.3rem;padding:.3rem}
.mg-ui{font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
.mg-ui button{font:15px/1 ui-sans-serif,system-ui,sans-serif;min-height:44px;min-width:44px;padding:0 .9rem;border-radius:.5rem;border:1px solid var(--rule);background:#222220;color:var(--fg);cursor:pointer;flex:none}
.mg-ui button:active{background:#2c2c2a}
.mg-ui button.quiet{background:none;color:var(--dim)}
#mg-bar{position:fixed;left:0;right:0;bottom:0;z-index:10;display:flex;gap:.4rem;overflow-x:auto;padding:.5rem .75rem calc(.5rem + env(safe-area-inset-bottom));background:#1a1a19;border-top:1px solid var(--rule)}
#mg-sheet{position:fixed;left:0;right:0;bottom:0;z-index:11;background:#1a1a19;border-top:1px solid var(--rule);padding:.75rem .75rem calc(.75rem + env(safe-area-inset-bottom))}
#mg-sheet .q{color:var(--dim);font-style:italic;max-height:4.5em;overflow:hidden;margin:0 0 .5rem}
#mg-sheet .why{color:#e0b46a;margin:.4rem 0 0}
textarea.mg-in{box-sizing:border-box;width:100%;min-height:5.5rem;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;background:#111110;color:var(--fg);border:1px solid var(--rule);border-radius:.5rem;padding:.5rem}
.mg-row{display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap;margin-top:.5rem}
.mg-card{background:#171716;border:1px solid var(--rule);border-left:3px solid #4a4f5a;border-radius:.4rem;padding:.55rem .7rem;margin:.5rem 0 1rem;white-space:pre-wrap;overflow-wrap:anywhere;user-select:none;-webkit-user-select:none}
.mg-card .who{font-size:12px;color:var(--dim)}
.mg-card .q{color:var(--dim);font-style:italic}
.mg-card .reply{border-top:1px solid var(--rule);margin-top:.5rem;padding-top:.45rem}
.mg-card.bare{display:none}
.mg-card.bare.open,.mg-card.bare.on{display:block}
/* A card at rest is short: who, two lines of the words it's on, three of what it says, how many replies. Open, all of it. */
.mg-card.top:not(.on){cursor:pointer;padding:.45rem .65rem}
.mg-card.top:not(.on)>.q,.mg-card.top:not(.on)>.b{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.mg-card.top:not(.on)>.b{-webkit-line-clamp:3}
.mg-card.top:not(.on)>.reply,.mg-card.top:not(.on)>.mg-row,.mg-card.top:not(.on)>.mg-nest,.mg-card.top:not(.on)>.quoted{display:none}
.mg-card.top.on>.sum{display:none}
.mg-card .sum{font-size:12px;color:var(--dim);margin-top:.25rem}
.mg-card.top.on{border-left-color:#c9a24a;z-index:3}
.mg-card .mg-row{gap:.15rem;flex-wrap:wrap;justify-content:flex-start}
.mg-card.mg-ui .mg-row button{min-height:40px;min-width:0;padding:0 .38rem;font-size:14px;border:0;background:none;color:var(--link)}
.mg-card.mg-ui .mg-row button.quiet{color:var(--dim)}
.mg-card.mg-ui .mg-row button.on{color:#e0d2a8}
.mg-card.mg-ui .mg-row button:active{background:#232321}
.mg-whole ul.mg-index{list-style:none;margin:0 0 1rem;padding:0;border-top:1px solid var(--rule)}
.mg-index li{border-bottom:1px solid var(--rule)}
.mg-ui .mg-index li>button{display:block;width:100%;text-align:left;min-height:44px;height:auto;border:0;border-radius:0;background:none;padding:.4rem .3rem;line-height:1.4;color:var(--fg)}
.mg-index li>button .k{display:block;font-size:12px;color:var(--dim)}
.mg-index li>button .x{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mg-leader{display:none}
/* Attention (PIE-791): a TL;DR is the card's face, the discussion folded behind it; kept and seen say so quietly. */
.mg-card .tldr{border-left:2px solid #6b8f5e;padding-left:.45rem;margin:.25rem 0}
.mg-card .tldr .k{display:block;font-size:11px;letter-spacing:.06em;color:#8fbf7e}
.mg-card .disc{margin-top:.35rem}
.mg-card .disc>summary{cursor:pointer;font-size:12px;color:var(--dim);min-height:28px;line-height:28px}
.mg-card.top:not(.on)>.disc,.mg-card.top:not(.on)>.tldr~.sum{display:none}
.mg-card.top:not(.on)>.tldr>.b{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.mg-card.kept{border-left-color:#6b8f5e}
.mg-card.earlier{opacity:.8}
.mg-card .rich{white-space:normal}
.mg-card .rich>:first-child{margin-top:0}.mg-card .rich>:last-child{margin-bottom:0}
.mg-card .rich p{margin:.3rem 0}
.mg-card .q .rich,.mg-card .q .rich>p{display:inline;margin:0}
.mg-card .rich blockquote{margin:.3rem 0;padding-left:.5rem;border-left:2px solid var(--rule);color:var(--dim)}
.mg-setting{display:flex;gap:.25rem;align-items:center;margin:.5rem 0 .25rem}
.mg-margin-bar{position:sticky;bottom:0;z-index:5;margin:2rem -1rem -4rem;padding:.35rem 1rem calc(.35rem + env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid var(--rule)}
.mg-margin-bar .mg-setting{margin:0;font:14px/1.4 ui-sans-serif,system-ui,sans-serif}
.mg-setting .who{margin-right:.35rem}
.mg-ui .mg-setting button{min-height:36px;min-width:0;padding:0 .6rem;font-size:14px}
.mg-ui .mg-setting button.on{border-color:#8a7a4a;color:#e0d2a8}
.mg-shelf .mg-card.inplace{margin:.25rem .3rem .6rem}
main.reader[data-margin=off] #mg-leader{display:none}
.mg-card.on{border-color:#5a6170}
/* A card's own words select like a note's (highlight, comment, ask on them); its controls don't. */
.mg-card .b{user-select:text;-webkit-user-select:text}
.mg-card .quoted{font-size:12px;color:var(--dim);margin-top:.35rem}
.mg-card .quoted a{color:var(--dim)}
.mg-card .mg-nest>.mg-card{margin:.4rem 0 .2rem;position:static}
.mg-card.picked{border-left-color:#8a7a4a}
.mg-ui button.on{border-color:#8a7a4a;color:#e0d2a8}
#mg-pick{position:fixed;left:0;right:0;bottom:0;z-index:10;display:flex;gap:.4rem;justify-content:flex-end;padding:.5rem .75rem calc(.5rem + env(safe-area-inset-bottom));background:#1a1a19;border-top:1px solid var(--rule)}
#mg-sheet .places{display:flex;gap:.4rem;flex-wrap:wrap;margin:0 0 .5rem}
#mg-sheet input.mg-find{box-sizing:border-box;width:100%;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;background:#111110;color:var(--fg);border:1px solid var(--rule);border-radius:.5rem;padding:.4rem .5rem;margin:0 0 .4rem}
#mg-sheet .found{max-height:10rem;overflow-y:auto;margin:0 0 .5rem}
#mg-sheet .found button{display:block;width:100%;text-align:left;margin:.2rem 0;min-height:40px;line-height:1.3}
.mg-complete{background:#161615;border:1px solid var(--rule);border-radius:.5rem;margin:.35rem 0 0;max-height:13rem;overflow-y:auto}
.mg-ui .mg-complete button{display:block;width:100%;text-align:left;min-height:44px;border:0;border-bottom:1px solid var(--rule);border-radius:0;background:none;padding:.35rem .6rem;line-height:1.3}
.mg-ui .mg-complete button.on{background:#1d2026}
.mg-complete .d{display:block;font-size:12px;color:var(--dim);overflow-wrap:anywhere}
.mg-complete p{margin:.5rem .6rem;font-size:14px}
#mg-toast a{color:var(--fg)}
#mg-toast button{margin-left:.6rem;min-height:36px}
mark.ann[data-ann],mark.ann[data-sub]{cursor:pointer}
mark.ann.on{outline:1px solid #6a7180}
.mg-whole h2{font:600 12px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:2rem 0 .4rem}
#mg-toast{position:fixed;left:1rem;right:1rem;bottom:5.5rem;z-index:12;max-width:30rem;margin:0 auto;background:#222220;color:var(--fg);border:1px solid var(--rule);border-radius:.5rem;padding:.55rem .9rem}
#mg-margin{display:none}
#ep0ch-agent{position:fixed;top:.75rem;right:.75rem;left:auto;z-index:13;max-width:min(26rem,calc(100% - 1.5rem));background:#1d2026;color:var(--fg);border:1px solid #4a4f5a;border-radius:.5rem;padding:.45rem .8rem;font-size:14px}
.line-anchor{scroll-margin-block:35vh}
article :is(p,li,h1,h2,h3,h4,h5,h6,td,th,figure,section,.callout-title):has(> .line-anchor:target){background:#1b1d21;outline:2px solid #6a7180}
.ep0ch-pointed{outline:2px solid #6a7180;outline-offset:.25rem;background:#1b1d21}
@media (min-width:65rem){
  main.reader{max-width:62rem;display:grid;grid-template-columns:minmax(0,42rem) 18rem;column-gap:2.25rem;align-items:start;position:relative}
  main.reader>*{grid-column:1}
  main.reader>#mg-leader{display:block;grid-column:auto;grid-row:auto;position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:2}
  #mg-leader path{fill:none;stroke:#6b5a30;stroke-width:1}
  #mg-leader circle{fill:#c9a24a}
  main.reader>#mg-margin{display:block;grid-column:2;grid-row:1 / span 20;position:relative;align-self:stretch}
  #mg-margin .mg-card{position:absolute;left:0;right:0;margin:0}
}
`;

/** The reader script on a tailnet page: where it is, where it reads and writes, which note this is, and whether it's the full page. */
interface ReaderTag { src: string; webmcp?: string; api: string; page: string; blockId: string; full: boolean }

/**
 * Where a page's search box asks (publish-search.ts): the listener's or the share's base, and the page's note (the
 * search's context). `form` false: the page draws its own box (the search page), and only the script is added.
 */
interface SearchTag { base: string; near?: string; form?: boolean }

/**
 * A page. `browse`: a tailnet page, with breadcrumbs (`nav` is them) and the folder list's style; `reader` also runs
 * the marginalia reader on it; `search` puts the search box above the breadcrumbs, with its script. Any other page is
 * as it always was: a bar, the body, no script.
 */
function htmlPage(title: string, body: string, nav: string, options: { reader?: ReaderTag; browse?: boolean; search?: SearchTag } = {}): string {
  const { reader, search } = options;
  const browse = options.browse || !!reader || !!search;
  // The reader first: it sets the polyfill's options, and registers its helpers once both have run.
  const script = (reader ? `<script src="${escapeHtml(reader.src)}" defer></script>${reader.webmcp ? `<script src="${escapeHtml(reader.webmcp)}" defer></script>` : ""}` : "") +
    (search ? `<script src="${escapeHtml(searchScriptPath(search.base))}" defer></script>` : "");
  const box = search && search.form !== false ? searchForm(search.base, search.near ? { near: search.near } : {}) : "";
  const main = reader
    ? `<main class="browse reader" data-marginalia="${escapeHtml(reader.api)}" data-page="${escapeHtml(reader.page)}" data-note="${escapeHtml(reader.blockId)}"${reader.full ? ` data-view="full"` : ""}>`
    : browse ? `<main class="browse">` : "<main>";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}${browse ? BROWSE_STYLE + SEARCH_STYLE : ""}</style>${script}</head>
<body>${main}${box}${browse ? nav : `<header class="bar">${nav}</header>`}
${body}
</main></body></html>
`;
}

const COMMON_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
/** Pages the publisher renders itself run no script and embed nothing but images, and a note's artifacts (PIE-793) from here. */
const RENDERED_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src * data:; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/**
 * A tailnet note's page runs one script, the publisher's own marginalia reader (PIE-774), from this origin, and it
 * talks only to this origin. No inline script, no eval, nothing from elsewhere: the page's own text is Markdown with
 * authored HTML shown as text, so nothing in a note can add a script tag. Public pages keep RENDERED_CSP: no script.
 */
const READER_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src * data:; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
/** The shares and sessions pages: their forms post only to this origin, and the search box's script runs. */
const SHARES_CSP = READER_CSP;
/**
 * An attached `.html` file runs as authored, but in a sandbox without
 * `allow-same-origin`: its scripts get an opaque origin, so they cannot read
 * other pages on the same host (the tailnet name also serves other mounts) or
 * this publisher's index with the viewer's credentials.
 */
const ATTACHED_HTML_CSP = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads";
/** An artifact line's page that can't run (a compile error, no compiler): the publisher's own words, framed in its note (PIE-793). */
const ARTIFACT_FAILED_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox";

function respond(body: string, contentType: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...COMMON_HEADERS, "content-type": contentType, ...extra } });
}

function renderedHtml(body: string, status = 200, csp = RENDERED_CSP): Response {
  return respond(body, "text/html; charset=utf-8", status, { "content-security-policy": csp });
}

function notFound(): Response {
  return respond("Not found\n", "text/plain; charset=utf-8", 404);
}

/**
 * A plain page of the web client's own (the sign-in page, a refusal): dark, no script, the publisher's style, nothing
 * from the outline. `body` is HTML the caller escaped.
 */
export function plainPage(title: string, body: string, status = 200, headers: Record<string, string> = {}): Response {
  return withHeaders(renderedHtml(htmlPage(title, `<article>\n${body}</article>\n`, `<nav class="crumbs">ep0ch</nav>`, { browse: true }), status), headers);
}

export { escapeHtml };

/** A share link that ended: 410, a plain dark page that names nothing from the outline. */
function shareGone(state: "expired" | "revoked"): Response {
  const said = state === "expired" ? "This link has expired." : "This link was turned off.";
  return renderedHtml(htmlPage("Link ended", `<article>\n<h1>${said}</h1>\n<p class="dim">Ask whoever sent it for a new one.</p>\n</article>\n`, "ep0ch"), 410);
}

/** A share link's path below the public listener: `/s/<token>`, then the page inside it. */
const SHARE_PATH = /^\/s\/([A-Za-z0-9_-]{16,128})(\/.*)?$/;

/** A path as it may be logged: a share's token is never written anywhere. */
export function redactSharePath(path: string): string {
  return path.replace(/\/s\/[^/?#]+/g, "/s/…");
}

/** Every public response also asks search engines not to list it: the link is the invitation. */
const PUBLIC_HEADERS = { "x-robots-tag": "noindex, nofollow" };

function withHeaders(response: Response, headers: Record<string, string>): Response {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

function isPublicIntent(properties: readonly BlockProperty[] | undefined): boolean {
  const intent = blockPublishIntent(properties ?? []);
  return typeof intent === "object" && intent.public;
}

/**
 * The index one audience sees: the tailnet sees everything published; the
 * public sees only public notes, each under its public title (which links
 * only other public notes).
 */
export function audienceIndex(index: PublishedIndex, audience: PublishAudience): PublishedIndex {
  if (audience === "tailnet") return index;
  return {
    ...index,
    entries: index.entries.flatMap((entry) => entry.public ? [{ ...entry, title: entry.public.title }] : []),
  };
}

/** `--public-url`: a path (`/share`) or a full URL whose path is the mount. */
export function parsePublicUrl(value: string | undefined): { basePath: string; origin?: string } {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { basePath: DEFAULT_PUBLIC_BASE_PATH };
  if (trimmed.startsWith("/")) return { basePath: normalizeBasePath(trimmed) || DEFAULT_PUBLIC_BASE_PATH };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`--public-url must be a path such as /share or a URL such as https://host.ts.net:8443/share: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`--public-url must be http(s): ${value}`);
  return { basePath: normalizeBasePath(url.pathname) || DEFAULT_PUBLIC_BASE_PATH, origin: url.origin };
}

/**
 * The one address the public listener may bind: loopback, or an address one of
 * this machine's interfaces has (its tailnet address, for a proxy elsewhere on
 * the tailnet). Anything else, including every spelling of "all interfaces"
 * (`0.0.0.0`, `::`, `::0`, `00.0.0.0`), is refused, so the listener is never on
 * the LAN by accident.
 */
export function checkPublicBind(address: string, interfaces = networkInterfaces()): string {
  const wanted = address.trim().toLowerCase();
  const own = new Set(Object.values(interfaces).flatMap((list) => (list ?? []).map((entry) => entry.address.toLowerCase())));
  if (wanted === "127.0.0.1" || wanted === "::1" || own.has(wanted)) return wanted;
  throw new Error(`--public-bind must be 127.0.0.1, ::1 or one of this machine's own addresses (such as its tailnet address), never every interface: ${address}`);
}

/** Where the public listener is mounted when nothing says otherwise. */
/**
 * Where a publisher is opened (`--url`, and a publisher's registration with the service, PIE-767): a full http(s) URL
 * with no query, fragment or credentials, since a note's path is added after it. Answers it without a trailing slash;
 * anything else throws, saying what is wanted.
 */
export function publisherUrl(value: string, label = "--url"): string {
  let parsed: URL | undefined;
  try { parsed = new URL(value); } catch { /* said below */ }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.search || parsed.hash || parsed.username || parsed.password || value.length > 2_000) {
    throw new Error(`${label} must be the full http(s) URL the publisher is opened at, with no query or fragment, such as https://host.ts.net/pub: ${value}`);
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

export const DEFAULT_PUBLIC_BASE_PATH = "/share";

export class Publisher {
  private readonly client: PublishClient;
  readonly basePath: string;
  /** The web client's root (`/pub`): where the home outline is, and `<webRoot>/o/` the outlines. */
  readonly webRoot: string;
  /** The public listener's mount (`/share`) and, when known, the origin anyone opens it at. */
  readonly publicBase: { basePath: string; origin?: string };
  private readonly maxBytes: number;
  private readonly log: (line: string) => void;
  private readonly allowedHosts: ReadonlySet<string>;
  /** The `--public-url` host: answered on the public listener only. */
  private readonly publicHost: string | undefined;
  private policy: AttachmentPolicy | null = null;
  private readonly compiler: ArtifactCompiler | null;
  private index: { value: PublishedIndex; at: number } | null = null;
  private calloutCache: { value: CalloutRegistry; at: number } | null = null;
  private building: Promise<PublishedIndex> | null = null;
  private watcher: OutlinerWatcher | null = null;
  private connected = false;
  /** Advanced by every content change; an index built across a change is not cached. */
  private generation = 0;
  /** Pages' script polls waiting for the next change. */
  private waiting = new Set<() => void>();
  private readonly marginalia: PageMarginalia;
  /** The outline's name, the top of a tailnet page's breadcrumbs. */
  private outlineName: string | undefined;
  /** The `cloudflare` shares' tunnels, when this publisher runs them. */
  private tunnels: ShareTunnels | null = null;
  /** Each share's view of the published index, until the next change. */
  private readonly shareIndexes = new Map<string, { generation: number; from: PublishedIndex; value: PublishedIndex }>();

  constructor(private readonly options: PublisherOptions) {
    this.client = options.client;
    this.basePath = normalizeBasePath(options.basePath);
    this.webRoot = options.webRoot === undefined ? this.basePath : normalizeBasePath(options.webRoot);
    this.publicBase = parsePublicUrl(options.publicUrl);
    this.maxBytes = Math.min(options.maxBytes ?? MAX_TEXT_FILE_BYTES, MAX_TEXT_FILE_BYTES);
    this.log = options.log ?? (() => {});
    this.allowedHosts = new Set((options.allowedHosts ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean));
    // The name anyone opens the public listener at (a custom domain behind Caddy, say) is a Host it answers.
    this.publicHost = this.publicBase.origin ? new URL(this.publicBase.origin).hostname.toLowerCase() : undefined;
    this.compiler = options.artifactCacheDirectory
      ? new ArtifactCompiler({ cacheDirectory: options.artifactCacheDirectory, log: this.log })
      : null;
    this.marginalia = new PageMarginalia({
      request: (request) => this.client.request(request as Parameters<PublishClient["request"]>[0]),
      view: (page, full, share) => this.view(page, full, share),
      report: (view) => this.options.presence === false ? Promise.resolve({}) : this.client.request({ action: "reader.report", view }),
      writes: (fresh) => this.options.writes?.(fresh) ?? Promise.resolve(null),
      basePath: this.basePath,
      locks: (properties) => blockPublishIntent(properties) === "never",
      generation: () => this.generation,
      changed: (since, ms) => this.changed(since, ms),
      linkable: (ids, share) => this.linkableNotes(ids, share),
      find: (query, near, share) => this.findNotes(query, near, share),
      render: (texts, share) => this.markWords(texts, share),
      // A share's tags are the outline's, so `#` completes on the tailnet only.
      complete: async (text, at, near, share) => completeAt(this.searchHost(share ? await this.shareIndex(share) : await this.readIndex(), share), text, at, near, !share),
      log: this.log,
    });
  }

  /** Resolves at the next content change after `since`, or after `ms`. */
  private changed(since: number, ms: number): Promise<void> {
    if (this.generation !== since) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.waiting.delete(done); resolve(); };
      const timer = setTimeout(done, ms);
      this.waiting.add(done);
    });
  }

  /**
   * A tailnet page as its marginalia routes need it (publish-page.ts): the note at `page`, locks read now, with its
   * rows in page order (the note alone on a folder page, its shown subtree with `full`) and the annotations it may show.
   */
  private async view(page: string, full: boolean, share?: PageShare): Promise<PageView | undefined> {
    if (!page) return undefined;
    const entry = await this.entryAt(page, share ? await this.shareIndex(share) : await this.readIndex(), "tailnet");
    if (!entry || (entry.type !== "block" && !share)) return undefined;
    if ((await this.lockedIds([entry.blockId])).size) return undefined;
    if (share && !(await this.inScope([entry.blockId], share)).has(entry.blockId)) return undefined;
    const whole = full
      ? await this.client.request<ProjectedBlockCollection>({
        action: "blocks.query", query: { subtreeRootId: entry.blockId, limit: PUBLISH_QUERY_LIMIT }, fields: ["text", "parent", "properties", "revision"],
      })
      : await this.noteWithAnnotations(entry.blockId);
    if (!whole) return undefined;
    // A mark's own page (its id is a page like any block's) shows the mark itself; the marks on it are its threads.
    const mark = (block: { id: string; properties?: readonly BlockProperty[] }) => block.id !== entry.blockId && isAnnotationBlock(block);
    const rows = shownSubtree({ ...whole, blocks: whole.blocks.filter((block) => !mark(block)) }, !share).filter((row) => !row.locked);
    const shown = new Set(rows.map((row) => row.block.id));
    const annotations = new Map(shownSubtree(whole, !share)
      .filter((row) => !row.locked && row.block.id !== entry.blockId && getProperty(row.block.properties ?? [], "type") === ANNOTATION_TYPE && shown.has(row.block.parentId ?? ""))
      .map((row) => [row.block.id, row.block.parentId!] as const));
    const blocks = rows.map((row) => ({ id: row.block.id, revision: row.block.revision ?? 0, text: row.block.text ?? "" }));
    if (!blocks[0]) return undefined;
    // A folder page lists its children too: one that's added, renamed or moved changes what the page draws.
    const listed = full ? [] : (await this.client.request<Block[]>({ action: "children", parentId: entry.blockId }))
      .filter((block) => !isAnnotationBlock(block)).map((block) => `${block.id}:${block.revision ?? 0}`);
    return { root: blocks[0], blocks, annotations, listed };
  }

  /** Loopback, a tailnet name, or a host the operator allowed; the port is ignored. */
  hostAllowed(header: string | null, audience: PublishAudience): boolean {
    if (!header) return false;
    let host: string;
    try {
      host = new URL(`http://${header}`).hostname.toLowerCase();
    } catch {
      return false;
    }
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" ||
      host.endsWith(".ts.net") || this.allowedHosts.has(host) || (audience === "public" && host === this.publicHost);
  }

  /**
   * Learns the outline's workspace root from `ping` and subscribes to the
   * content feed as an observer: any committed change drops the cached index,
   * so unpublishing takes effect on the next request.
   */
  async start(): Promise<OutlinerServiceStatus> {
    if (!this.client.requireCompatibleService || !this.client.watch) throw new Error("Publisher.start needs a socket client");
    const status = await this.client.requireCompatibleService();
    this.outlineName = status.outline?.name;
    const roots = [...(this.options.roots ?? [])];
    const location = status.location;
    // Attachments are checked on this machine's filesystem and read by the service from its own:
    // the check means nothing unless both are the same machine.
    const local = location !== undefined && location.hostname === hostname();
    if (local && !this.options.excludeWorkspaceRoot) roots.unshift(location.workspaceRoot);
    if (!local) this.log(`publish: the service runs on ${location?.hostname ?? "an unknown machine"}, not here; attachments are not served`);
    const canonical = canonicalPublishRoots(roots);
    for (const problem of canonical.problems) this.log(`publish: ${problem}`);
    this.policy = {
      roots: canonical.roots,
      workspaceRoot: local ? location.workspaceRoot : process.cwd(),
      maxBytes: this.maxBytes,
      ...(local ? {} : { remoteService: true }),
    };
    if (this.options.tunnels) {
      this.tunnels = new ShareTunnels({
        request: (request) => this.client.request(request as Parameters<PublishClient["request"]>[0]),
        // A tunnel's own way in: this share alone, on loopback, whatever Host a request names.
        ingress: (shareId) => {
          const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 30, fetch: (request, server) => this.handle(publisherRequest(request, server.requestIP(request)?.address), "public", shareId) });
          return { port: server.port!, stop: () => { void server.stop(true); } };
        },
        log: this.log,
        ...(this.options.cloudflared ? { binary: this.options.cloudflared } : {}),
        ...(this.options.tunnelSweepMs ? { sweepMs: this.options.tunnelSweepMs } : {}),
      });
    }
    const connected = Promise.withResolvers<void>();
    this.watcher = this.client.watch({
      // Where it is opened, so the service can give a published note's web URL (notes.address, PIE-767).
      client: { clientId: `publish-${crypto.randomUUID()}`, role: "observer", contextId: "publish", ...(this.address().url || this.address().publicUrl ? { publish: this.address() } : {}) },
      onConnect: () => {
        this.connected = true;
        this.invalidate();
        connected.resolve();
        void this.tunnels?.reconcile();
      },
      onDisconnect: () => {
        this.connected = false;
      },
      onEvent: (event) => {
        if (event.domain === "content") this.invalidate();
        // A share started or ended: its tunnel, if it has one, starts or stops.
        if (event.domain === "shares") void this.tunnels?.reconcile();
      },
      onError: (error) => this.log(`publish: change feed: ${error.message}`),
    });
    await Promise.race([connected.promise, Bun.sleep(3_000)]);
    return status;
  }

  /** Whether its change feed is connected now: a service that went away (a machine asleep) isn't. */
  get isConnected(): boolean {
    return this.connected;
  }

  /** What heads its pages: where the outline is served from when that's said, else its name. */
  private rootLabel(): string {
    return this.options.provenance?.() ?? this.outlineName ?? "outline";
  }

  /** Where this publisher is opened: what it tells the service. */
  address(): PublisherAddress {
    const url = this.options.url?.trim().replace(/\/+$/, "");
    const publicUrl = this.publicBase.origin ? `${this.publicBase.origin}${this.publicBase.basePath}` : undefined;
    return { ...(this.options.tailnetUrl ? { tailnetUrl: this.options.tailnetUrl } : {}), ...(url ? { url } : {}), ...(publicUrl ? { publicUrl } : {}), ...(this.options.tunnels ? { tunnels: true } : {}) };
  }

  /**
   * The publisher over the service itself, in-process (PIE-767): no listener and no attachments, only the index and
   * a note's rendering. `notes.render` and `notes.address` use it, so a note an extension sends somewhere reads as its
   * published page does, through this one renderer.
   */
  static inService(client: PublishClient, address: PublisherAddress = {}): Publisher {
    const publisher = new Publisher({ client, ...(address.publicUrl ? { publicUrl: address.publicUrl } : {}), ...(address.url ? { url: address.url } : {}) });
    publisher.policy = { roots: [], workspaceRoot: "/", maxBytes: publisher.maxBytes, remoteService: true };
    return publisher;
  }

  /**
   * Where a note is published, when it is (and not locked): its slug, whether it is public, and its web URLs from
   * the address the publisher gave (`url` by its slug; `permalink` by its id, which holds while it stays published).
   */
  async published(blockId: string): Promise<NotePublication | undefined> {
    const entry = (await this.readIndex()).entries.find((candidate) => candidate.blockId === blockId);
    if (!entry || (await this.lockedIds([blockId])).size) return undefined;
    const { url, publicUrl } = this.address();
    const isPublic = !!entry.public;
    const permalinkBase = isPublic && publicUrl ? publicUrl : url;
    return {
      slug: entry.slug,
      public: isPublic,
      ...(url ? { url: `${url}${entry.path}` } : {}),
      ...(isPublic && publicUrl ? { publicUrl: `${publicUrl}${entry.path}` } : {}),
      ...(permalinkBase ? { permalink: `${permalinkBase}/p/${entry.blockId}` } : {}),
    };
  }

  /**
   * A note's tailnet page by its id (`<url>/p/<id>`): the tailnet serves every note but a locked one (PIE-782), published
   * or not. Absent when the publisher didn't say where it is opened, or the note is `[publish::never]` or under one.
   */
  async pageUrl(blockId: string): Promise<string | undefined> {
    const { url } = this.address();
    if (!url || (await this.lockedIds([blockId])).size) return undefined;
    return `${url}/p/${blockId}`;
  }

  /**
   * A note and the notes under it, rendered as its published page renders them (PIE-767), published or not: the
   * text a reader of the page reads, as Markdown or as HTML (the article, without the page around it). Its links to
   * published notes are their web URLs when the publisher said where it is opened, else their labels. A note that is
   * `[publish::never]`, or under one, is refused: nothing renders it for anywhere outside.
   */
  async renderNote(blockId: string, format: "markdown" | "html", options: { audience?: PublishAudience; marks?: boolean } = {}): Promise<RenderedNote> {
    const audience = options.audience ?? "tailnet";
    const read = await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [blockId], fields: ["title", "properties", "timestamps"] });
    const block = read.blocks[0];
    if (!block) throw new Error(`Block not found: ${blockId}`);
    if ((await this.lockedIds([blockId])).size) {
      throw new Error(`${blockId} is [publish::never], or under a note that is: it isn't rendered for anywhere outside the outline`);
    }
    const full = audienceIndex(await this.readIndex(), audience);
    const { url, publicUrl } = this.address();
    const base = audience === "public" ? publicUrl : url;
    // Without a URL to link to, a link is its label: a path on no host means nothing where the text is going.
    const index = base ? full : { ...full, labelsOnly: true };
    const entry = full.entries.find((candidate) => candidate.blockId === blockId) ?? {
      blockId, title: publishedTitle(block.title ?? "", new Map()) || blockId, path: `/p/${blockId}`, slug: blockId, type: "block" as const, updatedAt: block.updatedAt ?? "",
    };
    const { markdown, marks, components, steps } = await this.blockMarkdown(entry, index, audience, format === "html" && options.marks === true, { base: base ?? "", format });
    const text = format === "markdown" ? markdown
      : htmlViewLinks(drawSteps(drawMarginalia(drawComponents(accentWorkId(renderMarkdownHtml(markdown, await this.callouts())), components), marks), steps, false), index, base ?? "");
    return { blockId, title: entry.title, format, text, published: full.entries.some((candidate) => candidate.blockId === blockId) };
  }

  /** The outline's callout types (`callouts.types`), kept a few seconds; the built-ins when the service can't answer. */
  private async callouts(): Promise<CalloutRegistry> {
    if (this.calloutCache && Date.now() - this.calloutCache.at < INDEX_MAX_AGE_MS) return this.calloutCache.value;
    let value: CalloutRegistry;
    try {
      value = publishedCalloutRegistry((await this.client.request<{ types: CalloutType[] }>({ action: "callouts.types" })).types);
    } catch {
      value = BUILTIN_CALLOUT_REGISTRY;
    }
    this.calloutCache = { value, at: Date.now() };
    return value;
  }

  private invalidate(): void {
    this.generation += 1;
    this.index = null;
    this.calloutCache = null;
    for (const wake of [...this.waiting]) wake();
  }

  /** The running tunnels' processes (publish-tunnels.ts), for the log and tests. */
  tunnelProcesses(): { shareId: string; pid: number; port: number; host?: string }[] {
    return this.tunnels?.processes() ?? [];
  }

  async stop(): Promise<void> {
    await this.options.door?.stop();
    await this.tunnels?.stop();
    await this.watcher?.stop();
    this.watcher = null;
  }

  get roots(): readonly string[] {
    return this.policy?.roots ?? [];
  }

  private requirePolicy(): AttachmentPolicy {
    if (!this.policy) throw new Error("Publisher has not started");
    return this.policy;
  }

  /** The published set, rebuilt after any content change (or after a few seconds, for attachment files). */
  async readIndex(): Promise<PublishedIndex> {
    const maxAge = this.connected ? INDEX_MAX_AGE_MS : DISCONNECTED_MAX_AGE_MS;
    if (this.index && Date.now() - this.index.at < maxAge) return this.index.value;
    this.building ??= this.buildIndex().finally(() => { this.building = null; });
    return this.building;
  }

  private async buildIndex(): Promise<PublishedIndex> {
    const started = Date.now();
    const generation = this.generation;
    const collection = await this.client.request<ProjectedBlockCollection>({
      action: "blocks.query",
      query: { filters: [{ key: PUBLISH_PROPERTY }], propertyScope: "block", limit: PUBLISH_QUERY_LIMIT },
      fields: ["title", "properties", "timestamps"],
    });
    const policy = this.requirePolicy();
    // A block under a `[publish::never]` note is locked with it, whatever it says itself.
    const wanted = collection.blocks.filter((block) => requestedSlug(block) !== null);
    const locked = await this.lockedIds(wanted.map((block) => block.id));
    const assigned = assignPaths(wanted.filter((block) => !locked.has(block.id)));
    const rawTitles = new Map(assigned.map(({ block }) => [block.id, block.title ?? ""]));
    // A public note's title links only other public notes, so it never names a tailnet-only one.
    const publicTitles = new Map(assigned.filter(({ block }) => isPublicIntent(block.properties)).map(({ block }) => [block.id, block.title ?? ""]));
    const entries = assigned.map(({ block, slug, collision }): PublishedEntry => {
      const source = getProperty(block.properties ?? [], "file");
      const check = source === undefined ? undefined : checkAttachment(source, policy);
      const served = check?.ok ? check : undefined;
      return {
        blockId: block.id,
        title: publishedTitle(block.title ?? "", rawTitles) || block.id,
        path: `/p/${slug}`,
        slug,
        ...(collision ? { collision } : {}),
        type: served ? served.type : "block",
        updatedAt: served && served.updatedAt > (block.updatedAt ?? "") ? served.updatedAt : block.updatedAt ?? "",
        ...(publicTitles.has(block.id) ? { public: { title: publishedTitle(block.title ?? "", publicTitles) || block.id } } : {}),
        ...(source === undefined ? {} : { attachment: { source, ...(check && !check.ok ? { refused: check.reason } : {}) } }),
      };
    }).sort((left, right) => left.path.localeCompare(right.path));
    const value = { entries, truncated: collection.completeness.kind === "truncated", builtAt: new Date().toISOString() };
    // A change during the build leaves the index uncached, so the next request sees it.
    if (generation === this.generation) this.index = { value, at: started };
    return value;
  }

  /** The full public URL of an entry, or its public path when the public origin is not known. */
  publicHref(entry: PublishedEntry): string | undefined {
    return entry.public ? `${this.publicBase.origin ?? ""}${this.publicBase.basePath}${entry.path}` : undefined;
  }

  private basePathFor(audience: PublishAudience): string {
    return audience === "public" ? this.publicBase.basePath : this.basePath;
  }

  /**
   * Answers one HTTP request: GET and HEAD of the index and published entries; on the tailnet, every note as a page
   * (PIE-782) and a page's marginalia routes (`/_marginalia/…`, publish-page.ts). The public audience has no index,
   * sees only public notes and takes no writes.
   */
  async handle(request: Request, audience: PublishAudience = "tailnet", tunnel?: string, signedIn?: SignedIn): Promise<Response> {
    const response = await this.answer(request, audience, tunnel, signedIn);
    return audience === "public" ? withHeaders(response, PUBLIC_HEADERS) : response;
  }

  private async answer(request: Request, audience: PublishAudience, tunnel?: string, signedIn?: SignedIn): Promise<Response> {
    // A tunnel's ingress answers its one share and nothing else; its Host is the tunnel's, whatever that is.
    if (tunnel !== undefined) {
      const shared = SHARE_PATH.exec(new URL(request.url).pathname);
      if (!shared) return notFound();
      try {
        return await this.answerShare(request, shared[1]!, shared[2] ?? "/", "", tunnel);
      } catch (error) {
        this.log(redactSharePath(`publish: tunnel ${request.method} ${new URL(request.url).pathname}: ${error instanceof Error ? error.message : String(error)}`));
        return respond("The outline could not be read\n", "text/plain; charset=utf-8", 502);
      }
    }
    // The sign-in listener checked its own Host (its public name) before it let the request through.
    if (!(signedIn && audience === "tailnet") && !this.hostAllowed(request.headers.get("host") ?? new URL(request.url).host, audience)) {
      return respond("Host not allowed\n", "text/plain; charset=utf-8", 421);
    }
    const url = new URL(request.url);
    const basePath = this.basePathFor(audience);
    let path = url.pathname;
    let mount = "";
    if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
      path = path.slice(basePath.length) || "/";
      mount = basePath;
    }
    // A share link (share-sessions.ts): on the public listener, below `/s/<token>`, checked against the service on
    // every request, so an expiry or a revoke holds from the next one.
    const shared = audience === "public" || path.endsWith("/snapshot.sqlite") ? SHARE_PATH.exec(path) : null;
    if (shared) {
      try {
        return await this.answerShare(request, shared[1]!, shared[2] ?? "/", mount);
      } catch (error) {
        this.log(redactSharePath(`publish: ${request.method} ${path}: ${error instanceof Error ? error.message : String(error)}`));
        return respond("The outline could not be read\n", "text/plain; charset=utf-8", 502);
      }
    }
    // The tailnet's list of open shares, where each is ended (and every one at once), and one started from a page.
    if (audience === "tailnet" && (path === "/shares" || path.startsWith("/shares/"))) {
      try {
        return await this.serveShares(request, path);
      } catch (error) {
        this.log(`publish: ${request.method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return respond("The outline could not be reached; try again\n", "text/plain; charset=utf-8", 502);
      }
    }
    // The signed-in web sessions (web-sessions.ts): every browser signed in at the sign-in listener, each with Revoke.
    if (audience === "tailnet" && (path === "/sessions" || path.startsWith("/sessions/"))) {
      try {
        return await this.serveSessions(request, path, signedIn);
      } catch (error) {
        this.log(`publish: ${request.method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return respond("The outline host could not be reached; try again\n", "text/plain; charset=utf-8", 502);
      }
    }
    // The door in the browser: a terminal, so where the person already is: the tailnet listener, or signed in (the gate
    // checked the session, and a POST's Origin). Never the public listener or a share link (both answered above).
    if (audience === "tailnet" && this.options.door && (path === "/door" || path.startsWith("/door/"))) {
      const caller = signedIn ? { owner: `web:${signedIn.sessionId}`, ...(signedIn.stillSignedIn ? { stillSignedIn: signedIn.stillSignedIn } : {}) } : undefined;
      return await this.options.door.handle(request, path, this.basePath, caller);
    }
    // A tailnet page's marginalia: its script, its threads and the one write route (publish-page.ts). Being on the
    // tailnet (or signed in at the sign-in listener) is the sign-in; the public listener has none of these.
    if (audience === "tailnet" && path.startsWith(`${PAGE_ROUTE}/`)) {
      try {
        return await this.marginalia.handle(request, path.slice(PAGE_ROUTE.length));
      } catch (error) {
        this.log(`publish: ${request.method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return respond(`${JSON.stringify({ ok: false, error: "the outline could not be reached; try again" })}\n`, "application/json; charset=utf-8", 502);
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return respond("Read-only\n", "text/plain; charset=utf-8", 405, { allow: "GET, HEAD" });
    }
    try {
      // The public listener has no index: a public note is reached by its link alone.
      if (audience === "public" && !path.startsWith("/p/")) return notFound();
      const accept = request.headers.get("accept") ?? "";
      // A browser on the tailnet lands on the outline's top level, a folder of its root notes (PIE-782).
      if (path === "/" && accept.includes("text/html")) return await this.serveFolder(null, await this.readIndex());
      if (path === "/" || path === "" || path === "/index" || path === "/index.html") {
        if (path !== "/index.html" && accept.includes("text/plain") && !accept.includes("text/html")) {
          return respond(renderIndexText(await this.readIndex(), this.basePath, this.publicHrefs()), "text/plain; charset=utf-8");
        }
        return renderedHtml(renderIndexHtml(await this.readIndex(), this.basePath, this.publicHrefs()));
      }
      // Recent replies (a bookmark on the phone): every reply on his threads, newest first, the unread marked.
      if (audience === "tailnet" && (path === "/replies" || path === "/replies/")) return await this.serveReplies(await this.readIndex());
      // Search, as the door's power bar finds notes (PIE-789): a page of results, or the box's results as JSON.
      if (audience === "tailnet" && (path === "/search" || path === "/search/")) return await this.serveSearch(request);
      if (path === "/index.txt") return respond(renderIndexText(await this.readIndex(), this.basePath, this.publicHrefs()), "text/plain; charset=utf-8");
      if (path === "/index.json") return respond(`${JSON.stringify(readerIndex(await this.readIndex()), null, 2)}\n`, "application/json; charset=utf-8");
      if (!path.startsWith("/p/")) return notFound();
      const media = MEDIA_PATH.exec(path);
      if (media) return await this.serveMedia(request, media[1]!.toLowerCase(), Number(media[2]), audience, undefined, media[3] === undefined ? undefined : Number(media[3]));
      const artifact = ARTIFACT_PATH.exec(path);
      if (artifact) return await this.serveArtifact(artifact[1]!.toLowerCase(), Number(artifact[2]), url.searchParams.get("view"), audience);
      let slug: string;
      try {
        slug = decodeURIComponent(path.slice(3)).replace(/\/+$/, "");
      } catch {
        return notFound();
      }
      const index = audienceIndex(await this.readIndex(), audience);
      const entry = await this.entryAt(slug, index, audience);
      if (!entry) return notFound();
      const view = url.searchParams.get("view");
      // On the tailnet a browser gets the page; `?view=md` (or anything without text/html, such as curl) the Markdown.
      const browsing = audience === "tailnet" && view === null && accept.includes("text/html");
      return await this.serveEntry(entry, index, browsing ? "html" : view, audience);
    } catch (error) {
      this.log(`publish: ${request.method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return respond("The outline could not be read\n", "text/plain; charset=utf-8", 502);
    }
  }

  /**
   * A share link's request (`/s/<token>/…`): the service says whether the token opens a session now (else 404, or 410
   * when it ended). Inside, it is the tailnet's web client cut to the session's scope: every note in it a page and a
   * folder, its links and embeds only to notes inside, and marginalia when the session takes comments.
   */
  /** The sign-in origin admits only this token-gated download without a browser session. */
  async snapshotDownload(request: Request, token: string): Promise<Response> {
    const taken = await this.client.request<{ path: string; shareId: string; bytes: number } | null>({
      action: "shares.snapshot.take", token, method: request.method,
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
      userAgent: request.headers.get("user-agent") ?? "",
    });
    if (!taken) return notFound();
    const compressed = new URL(request.url).searchParams.get("gz") === "1";
    const headers = {
      "content-type": compressed ? "application/gzip" : "application/vnd.sqlite3",
      "content-disposition": `attachment; filename="snapshot.sqlite${compressed ? ".gz" : ""}"`,
      "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow",
      ...(compressed ? {} : { "content-length": String(taken.bytes) }),
    };
    if (request.method === "HEAD") return new Response(null, { headers });
    if (request.signal.aborted) {
      await this.client.request({ action: "shares.snapshot.finish", shareId: taken.shareId, fetched: false, bytes: 0 });
      return notFound();
    }
    const stream = Bun.file(taken.path).stream();
    const reader = (compressed ? stream.pipeThrough(new CompressionStream("gzip")) : stream).getReader();
    let ended = false;
    let bytes = 0;
    const finish = async (fetched: boolean) => {
      if (ended) return;
      ended = true;
      await this.client.request({ action: "shares.snapshot.finish", shareId: taken.shareId, fetched, bytes });
    };
    const abort = () => { void reader.cancel().then(() => finish(false)).catch(error => this.log(`publish: snapshot abort: ${String(error)}`)); };
    request.signal.addEventListener("abort", abort, { once: true });
    // lib.dom omits Bun's direct-stream constructor overload.
    const DirectStream = ReadableStream as unknown as new (source: Bun.DirectUnderlyingSource<Uint8Array>) => ReadableStream<Uint8Array>;
    const body = new DirectStream({
      type: "direct",
      async pull(controller) {
        try {
          while (!ended) {
            const next = await reader.read();
            if (next.done) {
              await controller.flush(true);
              await finish(!request.signal.aborted);
              controller.end();
              break;
            }
            // Await the HTTP sink's backpressure, rather than declaring success when the file was read ahead.
            await controller.write(next.value);
            bytes += next.value.byteLength;
          }
        } catch (error) { await finish(false); controller.close(error instanceof Error ? error : new Error(String(error))); }
        finally { request.signal.removeEventListener("abort", abort); }
      },
      async cancel() { try { await reader.cancel(); } finally { await finish(false); request.signal.removeEventListener("abort", abort); } },
    });
    return new Response(body, { headers });
  }

  private async answerShare(request: Request, token: string, rest: string, mount: string, tunnel?: string): Promise<Response> {
    if (rest === "/snapshot.sqlite") return this.snapshotDownload(request, token);
    const found = await this.client.request<ShareResolution>({ action: "shares.resolve", token });
    if (found.status === "unknown") return notFound();
    if (found.status === "ended") return shareGone(found.state);
    if (found.share.snapshot) return notFound();
    // A tunnel's share is answered on its own tunnel's ingress only (its email gate is in front of it), never on the
    // public listener; and a tunnel's ingress answers nothing but its share.
    if (found.share.via === "cloudflare" ? found.share.id !== tunnel : tunnel !== undefined) return notFound();
    const share: PageShare = {
      // Links stay as the request came: at the host's root (`/s/<token>`), or under the listener's mount when it was asked there.
      id: found.share.id, base: `${mount}/s/${token}`, scope: found.share.scope, comments: found.share.comments,
      active: async () => (await this.client.request<ShareResolution>({ action: "shares.resolve", token })).status === "active",
    };
    if (rest.startsWith(`${PAGE_ROUTE}/`)) return this.marginalia.handle(request, rest.slice(PAGE_ROUTE.length), share);
    if (request.method !== "GET" && request.method !== "HEAD") return respond("Read-only\n", "text/plain; charset=utf-8", 405, { allow: "GET, HEAD" });
    const media = MEDIA_PATH.exec(rest);
    if (media) return this.serveMedia(request, media[1]!.toLowerCase(), Number(media[2]), "tailnet", share, media[3] === undefined ? undefined : Number(media[3]));
    const artifact = ARTIFACT_PATH.exec(rest);
    if (artifact) return this.serveArtifact(artifact[1]!.toLowerCase(), Number(artifact[2]), new URL(request.url).searchParams.get("view"), "tailnet", share);
    if (rest === "/search" || rest === "/search/") return this.serveSearch(request, share);
    const index = await this.shareIndex(share);
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    const shown = view === null && (request.headers.get("accept") ?? "").includes("text/html") ? "html" : view;
    let address: string;
    if (rest === "/" || rest === "") {
      if (share.scope.kind === "outline") return this.serveFolder(null, index, share);
      address = share.scope.blockId;
    } else if (rest.startsWith("/p/")) {
      try { address = decodeURIComponent(rest.slice(3)).replace(/\/+$/, ""); } catch { return notFound(); }
    } else return notFound();
    const entry = await this.entryAt(address, index, "tailnet");
    if (!entry || !(await this.inScope([entry.blockId], share)).has(entry.blockId)) return notFound();
    return this.serveEntry(entry.type === "block" ? entry : { ...entry, type: "block" }, index, shown, "tailnet", share);
  }

  /**
   * Search (PIE-789): the service's one search (`tree.search`, the power bar's, from the note the page was on), as a page
   * here may show its notes: on the tailnet every note but a locked one; inside a share only its notes. A page of
   * results (it works with no script), or with `format=json` the box's results (publish-search.js).
   */
  private async serveSearch(request: Request, share?: PageShare): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return respond("Read-only\n", "text/plain; charset=utf-8", 405, { allow: "GET, HEAD" });
    const url = new URL(request.url);
    const near = url.searchParams.get("near")?.trim();
    const from = near && BLOCK_ID.test(near) && (await this.openIds([near], share)).has(near) ? near : undefined;
    const index = share ? await this.shareIndex(share) : await this.readIndex();
    const answer = await searchNotes(this.searchHost(index, share), url.searchParams.get("q") ?? "", from);
    if (url.searchParams.get("format") === "json") return respond(`${JSON.stringify(answer)}\n`, "application/json; charset=utf-8");
    const base = share?.base ?? this.basePath;
    const top = share?.scope.kind === "note" ? noteTitle(share.scope.title) || "shared note" : this.rootLabel();
    const crumbs = `<nav class="crumbs"><a href="${escapeHtml(`${base}/`)}">${escapeHtml(top)}</a> / <span>Search</span></nav>`;
    const page = htmlPage(answer.query ? `${answer.query} · search` : "Search", searchResultsHtml(answer, base, from), crumbs, { search: { base, form: false } });
    return renderedHtml(page, 200, READER_CSP);
  }

  /** What a search or a comment box's completion on this page may show and link (publish-search.ts). */
  private searchHost(index: PublishedIndex, share?: PageShare): SearchHost {
    const base = share?.base ?? this.basePath;
    return {
      request: (request) => this.client.request(request as never),
      shown: (ids) => this.openIds(ids, share),
      href: (blockId) => `${base}${index.entries.find((entry) => entry.blockId === blockId)?.path ?? `/p/${encodeURIComponent(blockId)}`}`,
      crumbs: !share || share.scope.kind === "outline",
      ...(share?.scope.kind === "note" ? { under: share.scope.blockId } : {}),
      crumbsOf: (ids) => this.crumbWords(ids),
    };
  }

  /**
   * Each note's crumbs as `tree.search` says them (its ancestors' titles, top first, ` › ` between), read a level at a
   * time for all of them at once: a tag's notes on a search page (PIE-800).
   */
  private async crumbWords(ids: readonly string[]): Promise<Map<string, string>> {
    const parentOf = new Map<string, string | null>(), titleOf = new Map<string, string>();
    let next = [...new Set(ids)];
    for (let level = 0; next.length && level < CRUMB_LEVELS; level++) {
      const read: { blocks: ProjectedBlock[] }[] = [];
      for (let at = 0; at < next.length; at += MAX_BLOCK_READ_IDS) {
        read.push(await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: next.slice(at, at + MAX_BLOCK_READ_IDS), fields: ["parent", "title"] }));
      }
      for (const block of read.flatMap((answer) => answer.blocks)) {
        parentOf.set(block.id, block.parentId ?? null);
        titleOf.set(block.id, noteTitle(block.title ?? "").slice(0, 90));
      }
      next = [...new Set(next.map((id) => parentOf.get(id)).filter((id): id is string => !!id && !parentOf.has(id)))];
    }
    const crumbs = new Map<string, string>();
    for (const id of ids) {
      const above: string[] = [];
      for (let at = parentOf.get(id); at && above.length < CRUMB_LEVELS; at = parentOf.get(at)) above.unshift(titleOf.get(at) ?? "");
      crumbs.set(id, above.filter(Boolean).join(" › ").slice(-500));
    }
    return crumbs;
  }

  /** Which of `ids` a page here shows: live (not in Trash), not locked, and inside the share when there is one. */
  private async openIds(ids: readonly string[], share?: PageShare): Promise<Set<string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Set();
    const gone = new Set<string>();
    const locked = await this.lockedIds(unique, gone);
    let open = unique.filter((id) => !locked.has(id) && !gone.has(id));
    if (share) { const inside = await this.inScope(open, share); open = open.filter((id) => inside.has(id)); }
    return new Set(open);
  }

  /**
   * The signed-in web sessions page (`<base>/sessions`, on the tailnet and at the sign-in listener): each browser signed
   * in (its device, who, last seen), each with Revoke, and Sign out everywhere; the one this request came with is marked,
   * with Sign out. The sessions are the host's, the same from every outline. Its forms post here from this page only.
   */
  private async serveSessions(request: Request, path: string, signedIn?: SignedIn): Promise<Response> {
    const base = this.basePath;
    if (request.method === "POST") {
      if (!sameOrigin(request)) return respond("A change comes from the sessions page itself\n", "text/plain; charset=utf-8", 403);
      if (path !== "/sessions/revoke") return notFound();
      const form = new URLSearchParams((await request.text()).slice(0, 4096));
      const all = form.get("all") === "1";
      try {
        await this.client.request(all ? { action: "web.sessions.revoke", all: true } : { action: "web.sessions.revoke", sessionId: form.get("id") ?? "" });
      } catch (error) {
        const why = `<article>\n<h1>Not done</h1>\n<p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>\n<p><a href="${escapeHtml(`${base}/sessions`)}">back to sessions</a></p>\n</article>\n`;
        return renderedHtml(htmlPage("Not done", why, `<nav class="crumbs"><a href="${escapeHtml(`${base}/sessions`)}">Sessions</a></nav>`, { browse: true }), 422);
      }
      // Ending this browser's own session (or every one) signs it out: back to the sign-in.
      const own = signedIn && (all || form.get("id") === signedIn.sessionId);
      return new Response(null, { status: 303, headers: { ...COMMON_HEADERS, location: own ? "/signin" : `${base}/sessions` } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return respond("Use GET or POST\n", "text/plain; charset=utf-8", 405, { allow: "GET, HEAD, POST" });
    if (path !== "/sessions" && path !== "/sessions/") return notFound();
    const { sessions } = await this.client.request<{ sessions: WebSession[] }>({ action: "web.sessions.list" });
    const ago = (iso: string) => {
      const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
      return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
    };
    const rows = sessions.map((session) => {
      const here = session.id === signedIn?.sessionId;
      return `<tr><td>${escapeHtml(session.device)}${here ? ` <strong>(this browser)</strong>` : ""}<div class="dim">${escapeHtml(session.id)} · ${escapeHtml(session.name ? `${session.name} (${session.subject})` : session.subject)} · signed in ${escapeHtml(session.createdAt.slice(0, 10))}</div></td>` +
        `<td>${escapeHtml(ago(session.lastSeenAt))}</td><td>${escapeHtml(session.expiresAt.slice(0, 10))}</td>` +
        `<td><form method="post" action="${escapeHtml(`${base}/sessions/revoke`)}"><input type="hidden" name="id" value="${escapeHtml(session.id)}"><button type="submit">${here ? "Sign out" : "Revoke"}</button></form></td></tr>`;
    }).join("\n");
    const list = sessions.length
      ? `<table class="shares"><thead><tr><th>browser</th><th>last seen</th><th>ends</th><th></th></tr></thead><tbody>\n${rows}\n</tbody></table>\n` +
        `<form method="post" action="${escapeHtml(`${base}/sessions/revoke`)}" class="share-new"><input type="hidden" name="all" value="1"><button type="submit">Sign out everywhere (${sessions.length})</button></form>\n`
      : `<p class="dim">No browser is signed in. Signing in at the web client's public address starts one.</p>\n`;
    const body = `<article>\n<h1>Sessions</h1>\n<p class="dim">Browsers signed in to the web client. Each lasts 30 days from its last use; Revoke ends it now. The same as <code>ep0ch web sessions</code> and <code>ep0ch web revoke &lt;id&gt;|--all</code>.</p>\n${list}</article>\n` +
      `<footer><a href="${escapeHtml(`${base}/`)}">${escapeHtml(this.rootLabel())}</a></footer>`;
    const crumbs = `<nav class="crumbs"><a href="${escapeHtml(`${base}/`)}">${escapeHtml(this.rootLabel())}</a> / <span>Sessions</span></nav>`;
    return renderedHtml(htmlPage("Sessions", body, crumbs, { search: { base } }), 200, SHARES_CSP);
  }

  /**
   * The tailnet's shares page (`<base>/shares`): every open share with its scope, link, time left and whether it takes
   * comments, each with Revoke, and Kill all; with `?scope=<id>`, a form that starts one for that note. Its forms post
   * here from this page only (Origin), and each answer goes back to the list.
   */
  private async serveShares(request: Request, path: string): Promise<Response> {
    const base = this.basePath;
    const back = () => new Response(null, { status: 303, headers: { ...COMMON_HEADERS, location: `${base}/shares` } });
    if (request.method === "POST") {
      if (!sameOrigin(request)) return respond("A change comes from the shares page itself\n", "text/plain; charset=utf-8", 403);
      const form = new URLSearchParams((await request.text()).slice(0, 4096));
      if (path !== "/shares/revoke" && path !== "/shares/start") return notFound();
      try {
        await this.client.request(path === "/shares/start"
          ? {
            action: "shares.start", ...(form.get("open") ? { open: form.get("open")! } : {}), ...(form.get("only") === "on" && form.get("open") ? { scope: form.get("open")! } : {}), ttl: form.get("ttl") || "1h", comments: form.get("comments") === "on", mutation: { author: "user" },
            ...(form.get("via") ? { via: form.get("via")! } : {}), ...(form.get("allowMail")?.trim() ? { allowMail: form.get("allowMail")! } : {}),
          }
          : form.get("all") === "1" ? { action: "shares.revoke", all: true } : { action: "shares.revoke", shareId: form.get("id") ?? "" });
      } catch (error) {
        // Refused (a locked note, a ttl out of range): said, with the way back.
        const why = `<article>\n<h1>Not done</h1>\n<p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>\n<p><a href="${escapeHtml(`${base}/shares`)}">back to shares</a></p>\n</article>\n`;
        return renderedHtml(htmlPage("Not done", why, `<nav class="crumbs"><a href="${escapeHtml(`${base}/shares`)}">Shares</a></nav>`, { browse: true }), 422);
      }
      return back();
    }
    if (request.method !== "GET" && request.method !== "HEAD") return respond("Use GET or POST\n", "text/plain; charset=utf-8", 405, { allow: "GET, HEAD, POST" });
    if (path !== "/shares" && path !== "/shares/") return notFound();
    const { shares } = await this.client.request<{ shares: ShareSession[] }>({ action: "shares.list" });
    const left = (iso: string) => {
      const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
      return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    };
    const note = (blockId: string, title: string) => `<a href="${escapeHtml(`${base}/p/${blockId}`)}">${escapeHtml(noteTitle(title) || blockId)}</a>`;
    const what = (share: ShareSession) => share.snapshot ? "SQLite snapshot (one download)" : (share.scope.kind === "outline" ? "the whole outline" : `only ${note(share.scope.blockId, share.scope.title)} and what's under it`) +
      (share.opens ? `, opening on ${note(share.opens.blockId, share.opens.title)}` : "");
    const how = (share: ShareSession) => share.via === "cloudflare" ? ` · Cloudflare tunnel${share.allowMail?.length ? ` for ${share.allowMail.join(", ")}` : ", public"}` : "";
    const rows = shares.map((share) => `<tr><td>${what(share)}<div class="dim">${escapeHtml(share.id)} · by ${escapeHtml(share.by)}${escapeHtml(how(share))}</div></td>` +
      `<td>${share.url ? `<a href="${escapeHtml(share.url)}" rel="noreferrer">${escapeHtml(share.url)}</a>` : `<span class="dim">${share.via === "cloudflare" ? `its tunnel is ${escapeHtml(share.tunnel?.state ?? "starting")}` : "no public listener has said its address"}</span>`}</td>` +
      `<td>${escapeHtml(left(share.expiresAt))}</td><td>${share.comments ? "on" : "off"}</td>` +
      `<td><form method="post" action="${escapeHtml(`${base}/shares/revoke`)}"><input type="hidden" name="id" value="${escapeHtml(share.id)}"><button type="submit">Revoke</button></form></td></tr>`).join("\n");
    const list = shares.length
      ? `<table class="shares"><thead><tr><th>shares</th><th>link</th><th>ends in</th><th>comments</th><th></th></tr></thead><tbody>\n${rows}\n</tbody></table>\n` +
        `<form method="post" action="${escapeHtml(`${base}/shares/revoke`)}" class="share-new"><input type="hidden" name="all" value="1"><button type="submit">Kill all ${shares.length}</button></form>\n`
      : `<p class="dim">No share is open. Start one from a note's page (share… at its foot), from chat, or with <code>ep0ch share start &lt;ref&gt;</code>.</p>\n`;
    // A note's page links here with ?open=<id>: the link opens on it. Without one, the form shares from the top.
    const wanted = new URL(request.url).searchParams.get("open")?.trim();
    const read = wanted && BLOCK_ID.test(wanted) ? await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [wanted], fields: ["title"] }) : { blocks: [] };
    const block = read.blocks[0];
    let start = "";
    if (!wanted || block) {
      const named = block ? escapeHtml(noteTitle(block.title ?? "") || block.id) : "";
      start = `<h2>${block ? `Share, opening on “${named}”` : "Share the outline"}</h2>\n<form method="post" action="${escapeHtml(`${base}/shares/start`)}" class="share-new">` +
          (block ? `<input type="hidden" name="open" value="${escapeHtml(block.id)}">` +
            `<label><input type="checkbox" name="only"> only this note and below</label>` : "") +
          `<label>for <select name="ttl"><option value="15m">15 minutes</option><option value="1h" selected>1 hour</option><option value="4h">4 hours</option><option value="24h">24 hours</option></select></label>` +
          `<label><input type="checkbox" name="comments" checked> comments (highlight, comment, ask, reply)</label>` +
          `<label>by <select name="via"><option value="edge" selected>this outline's public host</option><option value="cloudflare">a Cloudflare tunnel of its own</option></select></label>` +
          `<label>only for (Cloudflare, by email PIN) <input type="text" name="allowMail" placeholder="someone@example.org, @example.org" size="32"></label>` +
          `<button type="submit">Start a public link</button></form>\n<p class="dim">Anyone with the link reads the outline as this site shows it (or, ticked, only that note and below) until it ends; [publish::never] notes stay hidden.</p>\n`;
    } else start = `<p class="dim">No note ${escapeHtml(wanted)} to share.</p>\n`;
    const body = `<article>\n<h1>Shares</h1>\n<p class="dim">Short-lived public links. Each ends by itself; Revoke ends it now.</p>\n${start}${list}</article>\n` +
      `<footer><a href="${escapeHtml(`${base}/`)}">${escapeHtml(this.rootLabel())}</a></footer>`;
    const crumbs = `<nav class="crumbs"><a href="${escapeHtml(`${base}/`)}">${escapeHtml(this.rootLabel())}</a> / <span>Shares</span></nav>`;
    return renderedHtml(htmlPage("Shares", body, crumbs, { search: { base } }), 200, SHARES_CSP);
  }

  /**
   * The entry at `/p/<address>`: a published note by its slug or id; on the tailnet also any other note, by its id or
   * its page name (PIE-782: the whole outline is served there, no `[publish::]` needed). Locks are checked by the caller.
   */
  private async entryAt(address: string, index: PublishedIndex, audience: PublishAudience): Promise<PublishedEntry | undefined> {
    const published = index.entries.find((candidate) => candidate.slug === address) ?? index.entries.find((candidate) => candidate.blockId === address);
    if (published || audience !== "tailnet" || !address) return published;
    let blockId: string | undefined;
    if (BLOCK_ID.test(address)) blockId = address;
    else if (tryNormalizePageAddress(address)) {
      const resolution = await this.client.request<PageAddressResolution>({ action: "pages.resolve", address });
      if (resolution.status === "resolved") blockId = resolution.block?.id;
    }
    if (!blockId) return undefined;
    const read = await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [blockId], fields: ["title", "properties", "timestamps"] });
    const block = read.blocks[0];
    return block ? browseEntry(block, index) : undefined;
  }

  private publicHrefs(): (entry: PublishedEntry) => string | undefined {
    return (entry) => this.publicHref(entry);
  }

  private async serveEntry(entry: PublishedEntry, index: PublishedIndex, view: string | null, audience: PublishAudience, share?: PageShare): Promise<Response> {
    const asHtml = view === "html";
    // The lock is checked again at request time, so `[publish::never]` holds from the next request
    // even before the change feed has cleared the cached index.
    if ((await this.lockedIds([entry.blockId])).size) return notFound();
    // So is `public`: a note made tailnet-only again leaves the public listener at once.
    if (audience === "public" && !(await this.stillPublic(entry.blockId))) return notFound();
    if (entry.type !== "block" && entry.attachment?.source !== undefined) {
      // Check again at request time: the file or a link in its path may have changed since the index.
      const check = checkAttachment(entry.attachment.source, this.requirePolicy());
      if (!check.ok) return respond("Attachment not served\n", "text/plain; charset=utf-8", 403);
      const contents = await this.client.request<FileContents>({ action: "files.read", path: check.path });
      if (contents.absolutePath !== check.path || contents.revision.size !== String(check.size) ||
        contents.revision.mtimeNs !== check.mtimeNs) {
        return respond("Attachment changed while it was read; try again\n", "text/plain; charset=utf-8", 409);
      }
      if (check.type === "html" || check.type === "react" || check.type === "svg" || check.type === "mermaid") {
        const failed = (body: string, status: number) => renderedHtml(this.page(entry, body, audience), status);
        return this.artifactResponse(entry.title, check.type, check.path, contents.text, view, `${this.basePathFor(audience)}${entry.path}?view=source`, failed);
      }
      if (check.type === "markdown") {
        if (asHtml) return renderedHtml(this.page(entry, htmlViewLinks(renderMarkdownHtml(await this.attachedMarkdown(entry, index, contents.text, audience), await this.callouts()), index, this.basePathFor(audience)), audience));
        // Raw, the public audience gets the file with its links and embeds resolved, so the ids
        // of notes that aren't public never leave in `((…))` as written.
        if (audience === "public") {
          return respond(`${await this.attachedMarkdown(entry, index, contents.text, audience)}\n`, "text/markdown; charset=utf-8", 200, { "content-disposition": "inline" });
        }
        return respond(contents.text, "text/markdown; charset=utf-8", 200, { "content-disposition": "inline" });
      }
      return respond(contents.text, "text/plain; charset=utf-8");
    }
    // On the tailnet a note's page is a folder that is also a file (PIE-775): its own text, then its children as
    // links. `?view=full` is the whole subtree on one page, as a public page always is.
    if (audience === "tailnet" && asHtml) return this.serveFolder(entry, index, share);
    // The tailnet listener (and the sign-in one) is the owner reading his own outline: nothing is gated by `[publish::]`
    // there but the `never` lock. A share link and the public listener are what publishing is for.
    const owner = audience === "tailnet" && !share;
    if (asHtml || (audience === "tailnet" && view === "full")) {
      const browse = audience === "tailnet";
      const rendered = await this.blockMarkdown(entry, index, audience, !share || share.comments, { browse, owner, anchors: [], ...(share ? { share } : {}) });
      const base = share?.base ?? this.basePathFor(audience);
      // A step's box changes from the owner's own page (PIE-811); a share's and a public page's are drawn, read-only.
      const article = htmlViewLinks(drawSteps(drawAnchors(drawMarginalia(drawComponents(accentWorkId(renderMarkdownHtml(rendered.markdown, await this.callouts())), rendered.components), rendered.marks, browse), rendered.anchors), rendered.steps, owner), rendered.index, base);
      if (!browse) return renderedHtml(this.page(entry, article, audience));
      const crumbs = await this.crumbs(entry, index, true, share);
      return renderedHtml(htmlPage(entry.title, `<article>\n${article}</article>\n${this.pageFooter(entry, true, share)}`, crumbs, { reader: this.readerTag(entry, true, share), search: { base, near: entry.blockId } }), 200, READER_CSP);
    }
    const { markdown } = await this.blockMarkdown(entry, index, audience, false, { format: "markdown", owner, ...(share ? { share } : {}) });
    return respond(markdown, "text/markdown; charset=utf-8", 200, { "content-disposition": "inline" });
  }

  /**
   * A tailnet page (PIE-775, PIE-782): breadcrumbs up to the outline, the note's own text with its marks (the file),
   * then its children as links, each with its title and a summary line (the folder). `entry` null is the outline's
   * top level. Annotations are drawn on their words, never listed; a `[publish::never]` child is a locked row.
   */
  private async serveFolder(entry: PublishedEntry | null, index: PublishedIndex, share?: PageShare): Promise<Response> {
    const base = share?.base ?? this.basePath;
    let article = `<h1>${escapeHtml(this.rootLabel())}</h1>\n`;
    if (entry) {
      if ((await this.lockedIds([entry.blockId])).size) return notFound();
      const whole = await this.noteWithAnnotations(entry.blockId, !share || share.comments);
      if (!whole) return notFound();
      const rendered = await this.blockMarkdown(entry, index, "tailnet", !share || share.comments, { whole, browse: true, owner: !share, anchors: [], ...(share ? { share } : {}) });
      article = htmlViewLinks(drawSteps(drawAnchors(drawMarginalia(drawComponents(accentWorkId(renderMarkdownHtml(rendered.markdown, await this.callouts())), rendered.components), rendered.marks, true), rendered.anchors), rendered.steps, !share), rendered.index, base);
    }
    const listedHere = (await this.client.request<Block[]>({ action: "children", parentId: entry?.blockId ?? null })).filter((block) => !isAnnotationBlock(block));
    // The outline's own views (Trash, Bookmarks) aren't notes to browse: Bookmarks is a quiet link at the top level's
    // foot, and Trash is nowhere (a note in Trash is never a page).
    const system = listedHere.filter(isSystemView);
    const all = listedHere.filter((block) => !isSystemView(block));
    // Views draw their rows (PIE-397's `views.read`): the note's own when it is one, and its view children as lanes,
    // side by side when it is a hub (two or more), a lane of their own in the list's place otherwise.
    const host = this.liveHost("tailnet", index, base, share);
    const shownViews = await host.shown(all.filter(isVirtualBranchDefinition).map((block) => block.id));
    const views = all.filter((block) => shownViews.has(block.id));
    const children = all.filter((block) => !shownViews.has(block.id));
    let lanes = "";
    if (entry) {
      const own = (await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [entry.blockId], fields: ["properties"] })).blocks[0];
      if (own && isVirtualBranchDefinition({ properties: own.properties ?? [] })) {
        const lane = await readViewLane(host, own, entry.title);
        lanes += `<section class="inside view"><h2>Rows <span class="dim">${lane.count}${lane.truncated ? "+" : ""}</span></h2>\n${viewRowsHtml(lane)}</section>\n`;
      }
    }
    if (views.length) {
      const viewTitles = await host.titles(views.map((view) => view.id));
      const read = await Promise.all(views.map((view) => readViewLane(host, view, viewTitles.get(view.id) || "a view")));
      lanes += `<section class="inside"><h2>${views.length > 1 ? "Board" : "View"} <span class="dim">${views.length}</span></h2>\n${boardHtml(read)}</section>\n`;
    }
    const listed = children.slice(0, MAX_LISTED_CHILDREN);
    const named = [...new Set(listed.flatMap(rowReferences))].slice(0, MAX_BLOCK_READ_IDS);
    const [counts, titles, notes] = await Promise.all([
      this.childCounts(listed.slice(0, MAX_COUNTED_CHILDREN).map((block) => block.id)),
      this.titles(listed.map((block) => block.id)),
      this.linkableNotes(named, share),
    ]);
    const links = new Map(notes.map((note) => [note.id, note]));
    const rows = listed.map((child) => folderRow(child, titles.get(child.id) ?? "", index, base, counts.get(child.id), links));
    const more = children.length > MAX_LISTED_CHILDREN ? `<p class="dim">and ${children.length - MAX_LISTED_CHILDREN} more (open it in the door to see them all)</p>\n` : "";
    const inside = children.length
      ? `<section class="inside"><h2>Inside <span class="dim">${children.length}</span></h2>\n<ul class="kids">\n${rows.join("\n")}\n</ul>\n${more}</section>\n`
      : "";
    const bookmarks = system.find((block) => getProperty(block.properties, "system-view")?.toLowerCase() === "bookmarks");
    const top = share ? "" : `<footer>${bookmarks ? `<a href="${escapeHtml(`${base}/p/${bookmarks.id}`)}">bookmarks</a> · ` : ""}<a href="${escapeHtml(`${base}/index`)}">published notes</a> · <a href="${escapeHtml(`${base}/shares`)}">shares</a> · <a href="${escapeHtml(`${this.webRoot}/o/`)}">outlines</a> · <a href="${escapeHtml(`${base}/sessions`)}">sessions</a></footer>`;
    const body = `<article>\n${article}</article>\n${lanes}${inside}${entry ? this.pageFooter(entry, false, share) : top}`;
    const crumbs = entry ? await this.crumbs(entry, index, false, share) : `<nav class="crumbs">${escapeHtml(this.rootLabel())}</nav>`;
    const title = entry?.title ?? this.outlineName ?? "outline";
    const search = { base, ...(entry ? { near: entry.blockId } : {}) };
    return entry
      ? renderedHtml(htmlPage(title, body, crumbs, { reader: this.readerTag(entry, false, share), search }), 200, READER_CSP)
      : renderedHtml(htmlPage(title, body, crumbs, { search }), 200, READER_CSP);
  }

  /**
   * Recent replies (the capability "Conversations in the margin"): the saved view's question (outline-core
   * recent-replies.ts) asked of the service, the unread ones (`unread:me`) marked. Each opens its note at the thread,
   * and opening it there marks it read. A reply on a locked note, or marked `[publish::never]`, isn't listed.
   */
  private async serveReplies(index: PublishedIndex): Promise<Response> {
    const base = this.basePath;
    const fields = ["text", "parent", "properties", "author", "timestamps"] as const;
    const [all, unread] = await Promise.all([
      this.client.request<ProjectedBlockCollection>({ action: "blocks.query", query: { where: RECENT_REPLIES_QUERY, sort: { field: "created", direction: "desc" }, limit: MAX_RECENT_REPLIES }, fields: [...fields] }),
      // The same order and limit: every unread one among those shown is among the newest unread.
      this.client.request<ProjectedBlockCollection>({ action: "blocks.query", query: { where: UNREAD_REPLIES_QUERY, sort: { field: "created", direction: "desc" }, limit: MAX_RECENT_REPLIES }, fields: ["parent"] }),
    ]);
    const fresh = new Set(unread.blocks.map((block) => block.id));
    // A reply's tree parent is its thread's comment; the comment's is the note it's on.
    const roots = [...new Set(all.blocks.map((block) => block.parentId).filter((id): id is string => !!id))];
    const read = async (ids: string[], wanted: ("text" | "parent" | "properties")[]) =>
      ids.length ? (await this.client.request<BlockReadCollection>({ action: "blocks.read", ids, fields: wanted })).blocks : [];
    const rootOf = new Map((await read(roots, ["text", "parent"])).map((block) => [block.id, block]));
    const notes = [...new Set([...rootOf.values()].map((block) => block.parentId).filter((id): id is string => !!id))];
    const [locked, titles, noteBlocks] = await Promise.all([
      this.lockedIds([...notes, ...all.blocks.map((block) => block.id)]),
      this.titles(notes),
      read(notes, ["properties"]),
    ]);
    const noteOf = new Map(noteBlocks.map((block) => [block.id, block]));
    const rows: string[] = [];
    let unreadCount = 0;
    for (const reply of all.blocks) {
      const root = reply.parentId ? rootOf.get(reply.parentId) : undefined;
      const noteId = root?.parentId ?? undefined;
      if (!root || !noteId || locked.has(noteId) || locked.has(reply.id)) continue;
      const isNew = fresh.has(reply.id);
      if (isNew) unreadCount += 1;
      const by = reply.author === "user" ? "you" : (reply.actorId ? actorName(reply.actorId) : "agent").replace(/^ext:/, "");
      const quote = /^[A-Z][a-z-]{0,23} on “(.*)”$/.exec((root.text ?? "").split("\n")[0] ?? "")?.[1] ?? "";
      const said = plainBody(extractAnnotationBody(reply.text ?? "")).replace(/\s+/g, " ").trim();
      const href = `${base}${notePath(noteOf.get(noteId) ?? { id: noteId }, index)}#thread=${root.id}`;
      const meta = [by, (reply.createdAt ?? "").slice(0, 16).replace("T", " "), `on ${noteTitle(titles.get(noteId) ?? "") || "a note"}`].join(" · ");
      rows.push(`<li${isNew ? ` class="new"` : ""}><a href="${escapeHtml(href)}"><span class="t">${isNew ? `<span class="dot" aria-label="unread">●</span> ` : ""}${escapeHtml(said.length > 220 ? `${said.slice(0, 219).trimEnd()}…` : said || "(empty)")}</span>` +
        `${quote ? `<span class="s">“${escapeHtml(quote)}”</span>` : ""}<span class="m">${escapeHtml(meta)}</span></a></li>`);
    }
    const list = rows.length
      ? `<ul class="kids replies">\n${rows.join("\n")}\n</ul>\n`
      : `<p class="dim">No replies yet. When someone (or @margin) answers in a thread you started or wrote in, it shows here.</p>\n`;
    const body = `<article>\n<h1>Recent replies</h1>\n<p class="dim">${unreadCount ? `${unreadCount} unread · ` : ""}replies on your threads, newest first. Opening one marks its thread read.</p>\n</article>\n` +
      `<section class="inside">${list}</section>\n<footer><a href="${escapeHtml(`${base}/`)}">${escapeHtml(this.rootLabel())}</a></footer>`;
    const crumbs = `<nav class="crumbs"><a href="${escapeHtml(`${base}/`)}">${escapeHtml(this.rootLabel())}</a> / <span>Recent replies</span></nav>`;
    return renderedHtml(htmlPage("Recent replies", body, crumbs, { search: { base } }), 200, READER_CSP);
  }

  /** Breadcrumbs from the outline's top level down to `entry`, each a link but the note itself (on its full page, a link back to the folder). */
  private async crumbs(entry: PublishedEntry, index: PublishedIndex, full: boolean, share?: PageShare): Promise<string> {
    const href = (path: string) => escapeHtml(`${share?.base ?? this.basePath}${path}`);
    let above = await this.ancestors(entry.blockId);
    const parts: string[] = [];
    // A share's crumbs start at what it shares: nothing above its note is named.
    if (share?.scope.kind === "note") {
      const rootId = share.scope.blockId;
      const at = above.findIndex((block) => block.id === rootId);
      above = at < 0 ? [] : above.slice(at);
    } else parts.push(`<a href="${href("/")}">${escapeHtml(this.rootLabel())}</a>`);
    for (const block of above) {
      const path = share?.scope.kind === "note" && block.id === share.scope.blockId ? "/" : notePath(block, index);
      parts.push(`<a href="${href(path)}">${escapeHtml(noteTitle(block.title ?? "") || block.id)}</a>`);
    }
    parts.push(full ? `<a href="${href(entry.path)}">${escapeHtml(entry.title)}</a>` : `<span>${escapeHtml(entry.title)}</span>`);
    return `<nav class="crumbs">${parts.join(" / ")}</nav>`;
  }

  private pageFooter(entry: PublishedEntry, full: boolean, share?: PageShare): string {
    const href = (query: string) => escapeHtml(`${share?.base ?? this.basePath}${entry.path}${query}`);
    const other = full ? `<a href="${href("")}">as a folder</a>` : `<a href="${href("?view=full")}">whole page</a>`;
    // On the tailnet, a note can be shared from its page: a short-lived public link (the shares page starts it).
    const sharing = share || this.options.shares === false ? "" : ` · <a href="${escapeHtml(`${this.basePath}/shares?open=${encodeURIComponent(entry.blockId)}`)}">share…</a>`;
    const door = share || !this.options.door ? "" : ` · <a href="${escapeHtml(`${this.basePath}/door?open=${encodeURIComponent(entry.blockId)}`)}">door</a>`;
    return `<footer>updated ${escapeHtml(entry.updatedAt.slice(0, 16).replace("T", " "))} · ${other} · <a href="${href("?view=md")}">markdown</a>${sharing}${door}</footer>`;
  }

  /** The notes above `blockId`, the top level first. A chain longer than the lock walk is cut there. */
  private async ancestors(blockId: string): Promise<ProjectedBlock[]> {
    const chain: ProjectedBlock[] = [];
    let at: string | null = blockId;
    for (let level = 0; at && level < LOCK_WALK_LIMIT; level++) {
      const read: BlockReadCollection = await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [at], fields: ["parent", "title", "properties"] });
      const block = read.blocks[0];
      if (!block) break;
      if (block.id !== blockId) chain.unshift(block);
      at = block.parentId ?? null;
    }
    return chain;
  }

  /** A note and its annotation children, as the rows a folder page renders (its other children are links, not rows). */
  private async noteWithAnnotations(blockId: string, withAnnotations = true): Promise<ProjectedBlockCollection | undefined> {
    const fields = ["text", "parent", "properties", "author", "revision", "timestamps"] as const;
    const read = await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [blockId], fields: [...fields] });
    const root = read.blocks[0];
    if (!root) return undefined;
    const annotations = withAnnotations ? (await this.client.request<Block[]>({ action: "children", parentId: blockId })).filter(isAnnotationBlock) : [];
    return {
      blocks: [{ ...root, depth: 0 }, ...annotations.map((block) => ({ ...block, depth: 1 }))],
      completeness: { kind: "complete" },
      fields: [...fields],
    };
  }

  /** Each note's title as the service gives it (its first line without property tokens, as Tree and the CLI label it). */
  private async titles(ids: readonly string[]): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    for (let start = 0; start < ids.length; start += MAX_BLOCK_READ_IDS) {
      const read = await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: ids.slice(start, start + MAX_BLOCK_READ_IDS), fields: ["title"] });
      for (const block of read.blocks) titles.set(block.id, block.title ?? "");
    }
    return titles;
  }

  /**
   * Notes a page may link to, each with its title and page address: none that's locked, and on a share none outside
   * it (those are said, never named). For a mark's "quoted in".
   */
  private async linkableNotes(ids: readonly string[], share?: PageShare): Promise<{ id: string; title: string; href: string | null }[]> {
    if (!ids.length) return [];
    const base = share?.base ?? this.basePath;
    const [locked, inside, titles] = await Promise.all([this.lockedIds(ids), share ? this.inScope(ids, share) : Promise.resolve(new Set(ids)), this.titles(ids)]);
    return ids.map((id) => locked.has(id) ? { id, title: "a locked note", href: null }
      : !inside.has(id) ? { id, title: "a note outside this link", href: null }
        : { id, title: titles.get(id) || "a note", href: `${base}/p/${encodeURIComponent(id)}` });
  }

  /** The outline's notes by words (the service's one search), for a page that asks where something goes; locked and out-of-share ones left out. */
  private async findNotes(query: string, near: string | undefined, share?: PageShare): Promise<{ id: string; title: string; path: string }[]> {
    const found = await this.client.request<GotoSearchCollection>({ action: "tree.search", query, ...(near ? { contextBlockId: near } : {}) });
    const ids = found.matches.map((match) => match.block.id);
    const [locked, inside] = await Promise.all([this.lockedIds(ids), share ? this.inScope(ids, share) : Promise.resolve(new Set(ids))]);
    return found.matches.filter((match) => !locked.has(match.block.id) && inside.has(match.block.id))
      // Inside a share a note's path would name its ancestors outside it: only its title then.
      .slice(0, 12).map((match) => ({ id: match.block.id, title: match.title, path: share ? "" : match.path }));
  }

  /**
   * Marks' words as the page draws a note's (PIE-791): references by title and linked to their pages, page links
   * resolved, Markdown drawn, callouts boxed; never a link to a locked note or one outside a share.
   */
  private async markWords(texts: readonly string[], share?: PageShare): Promise<string[]> {
    const base = share?.base ?? this.basePath;
    const index = share ? await this.shareIndex(share) : await this.readIndex();
    const pages = await this.resolvePages(texts);
    let linked = await this.browseIndex(await this.linkable(index, texts, pages), texts, pages);
    if (share?.scope.kind === "note") {
      const inside = await this.inScope(linked.entries.map((entry) => entry.blockId), share);
      linked = { ...linked, entries: linked.entries.filter((entry) => inside.has(entry.blockId)) };
    }
    const callouts = await this.callouts();
    return texts.map((text) => htmlViewLinks(renderMarkdownHtml(publishedText(text, { index: linked, basePath: base, pages }), callouts), linked, base));
  }

  /** How many notes each of `ids` holds (annotations aren't notes), a few reads at a time. */
  private async childCounts(ids: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PAGE_RESOLVE_CONCURRENCY, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        try {
          const children = await this.client.request<Block[]>({ action: "children", parentId: id });
          counts.set(id, children.filter((block) => !isAnnotationBlock(block)).length);
        } catch { /* listed without its count */ }
      }
    }));
    return counts;
  }

  /**
   * The index a tailnet page links with: the published notes, and every other note `texts` (and their embeds) name,
   * at its own page (PIE-782). A locked note stays a label.
   */
  private async browseIndex(index: PublishedIndex, texts: readonly string[], pages: ReadonlyMap<string, string>, embeds?: EmbedExpansion): Promise<PublishedIndex> {
    const known = new Set(index.entries.map((entry) => entry.blockId));
    const embedded = embeds ? Object.values(embeds.read.blocks).map((block) => block.text) : [];
    const ids = [...new Set([
      ...[...texts, ...embedded].flatMap((text) => [...blockReferenceOccurrences(text)].map((occurrence) => occurrence.blockId)),
      ...pages.values(),
    ])].filter((id) => !known.has(id)).slice(0, MAX_BLOCK_READ_IDS);
    if (!ids.length) return index;
    const read = await this.client.request<BlockReadCollection>({ action: "blocks.read", ids, fields: ["title", "properties", "timestamps"] });
    const locked = await this.lockedIds(read.blocks.map((block) => block.id));
    const extra = read.blocks.filter((block) => !locked.has(block.id)).map((block) => browseEntry(block, index));
    return extra.length ? { ...index, entries: [...index.entries, ...extra] } : index;
  }

  /** The reader script's tag on a tailnet page: where it is, where it reads and writes, and which note this is. */
  private readerTag(entry: PublishedEntry, full: boolean, share?: PageShare): ReaderTag {
    const base = share?.base ?? this.basePath;
    // The reader names its note by id: an address (a slug, a page name) could later name another note.
    const webmcp = webmcpScriptPath(base);
    return { src: readerScriptPath(base), ...(webmcp ? { webmcp } : {}), api: `${base}${PAGE_ROUTE}`, page: entry.blockId, blockId: entry.blockId, full };
  }

  /**
   * An artifact as claude.ai runs it, the same for a `[file::]` note's page and an `[artifact::]` line's frame (PIE-793):
   * HTML as authored, SVG as itself, mermaid drawn, React compiled to one page, each in the attached-HTML sandbox;
   * `?view=source` its source, as claude.ai's "code" tab shows it. `failed` draws the page a React artifact that doesn't
   * compile gets.
   */
  private async artifactResponse(title: string, type: "html" | "react" | "svg" | "mermaid", path: string, text: string, view: string | null,
    sourceHref: string, failed: (body: string, status: number) => Response): Promise<Response> {
    if (view === "source") return respond(text, "text/plain; charset=utf-8");
    if (type === "html") return respond(text, "text/html; charset=utf-8", 200, { "content-security-policy": ATTACHED_HTML_CSP });
    if (type === "svg") return respond(text, "image/svg+xml; charset=utf-8", 200, { "content-security-policy": ATTACHED_HTML_CSP });
    if (type === "mermaid") return respond(mermaidArtifactPage(title, text), "text/html; charset=utf-8", 200, { "content-security-policy": ATTACHED_HTML_CSP });
    return this.serveReact(title, text, extname(path).toLowerCase() === ".tsx" ? ".tsx" : ".jsx", sourceHref, failed);
  }

  /**
   * A React artifact compiled to one page, run in the same sandbox as attached
   * HTML. A compile error is a readable page (422) naming the artifact's line,
   * never a stack trace or a path on this machine.
   */
  private async serveReact(title: string, source: string, extension: ".jsx" | ".tsx", sourceHref: string, failed: (body: string, status: number) => Response): Promise<Response> {
    if (!this.compiler) return failed("<h1>Not compiled</h1>\n<p>This publisher has no artifact cache, so React artifacts are not compiled.</p>\n", 503);
    const build = await this.compiler.compile(source, extension);
    if (build.ok) {
      return respond(reactArtifactPage(title, build.script), "text/html; charset=utf-8", 200, { "content-security-policy": ATTACHED_HTML_CSP });
    }
    const problems = build.problems.map((problem) => `<pre>${escapeHtml(problem)}</pre>`).join("\n");
    const status = build.transient ? 503 : 422;
    const body = `<h1>${build.transient ? "Not compiled yet" : "This artifact does not compile"}</h1>\n${problems}\n` +
      `<p class="dim">Fix the file and reload; <a href="${escapeHtml(sourceHref)}">source</a>.</p>\n`;
    return failed(body, status);
  }

  /**
   * The artifact line `line` of note `blockId` names (`/p/<id>/artifact/<line>`, PIE-793), run as its page, when a page
   * here shows that note (serveMedia's rule: not locked; inside a share's scope; on the public listener, under a note that
   * is public now). Its path is the note's, read again now, and checked as an attachment is (the publish roots, which hold
   * the outline's own folder; nothing hidden; no link out); the URL never carries one.
   */
  private async serveArtifact(blockId: string, line: number, view: string | null, audience: PublishAudience, share?: PageShare): Promise<Response> {
    const policy = this.requirePolicy();
    if (policy.remoteService) return notFound();
    if ((await this.lockedIds([blockId])).size) return notFound();
    if (share && !(await this.inScope([blockId], share)).has(blockId)) return notFound();
    if (audience === "public" && !share && !(await this.reachedFromPublic(blockId))) return notFound();
    const block = (await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [blockId], fields: ["text"] })).blocks[0];
    const spec = block ? noteMediaLines(block.text ?? "").get(line) : undefined;
    if (!spec || spec.kind !== "artifact") return notFound();
    const read = await this.readArtifact(spec, policy);
    if (!read) return notFound();
    const title = artifactTitle(spec, read.text);
    const failed = (body: string, status: number) => renderedHtml(htmlPage(title, `<article>\n${body}</article>\n`, escapeHtml(title)), status, ARTIFACT_FAILED_CSP);
    const sourceHref = `${share?.base ?? this.basePathFor(audience)}${artifactPagePath(blockId, line)}?view=source`;
    return this.artifactResponse(title, read.type, read.path, read.text, view, sourceHref, failed);
  }

  /** An artifact line's file, when it may leave the machine and is a kind claude.ai runs: checked, then read through the service. */
  private async readArtifact(spec: MediaSpec, policy: AttachmentPolicy): Promise<{ type: "html" | "react" | "svg" | "mermaid"; path: string; text: string } | null> {
    if (!artifactKind(spec.path)) return null;
    const check = checkAttachment(spec.path, policy);
    if (!check.ok || (check.type !== "html" && check.type !== "react" && check.type !== "svg" && check.type !== "mermaid")) return null;
    const contents = await this.client.request<FileContents>({ action: "files.read", path: check.path }).catch(() => null);
    // The file read is the one checked: a file changed or swapped since (a link put in its place) is not served.
    if (!contents || contents.absolutePath !== check.path || contents.revision.size !== String(check.size) || contents.revision.mtimeNs !== check.mtimeNs) return null;
    return { type: check.type, path: check.path, text: contents.text };
  }

  private page(entry: PublishedEntry, body: string, audience: PublishAudience): string {
    const href = (path: string) => escapeHtml(`${this.basePathFor(audience)}${path}`);
    // The public listener has no index to link to.
    const nav = audience === "public" ? escapeHtml(entry.slug) : `<a href="${href("/index")}">index</a> / ${escapeHtml(entry.slug)}`;
    return htmlPage(entry.title, `<article>\n${body}</article>\n<footer>updated ${escapeHtml(entry.updatedAt)} · <a href="${href(entry.path)}">raw</a></footer>`, nav);
  }

  /**
   * The image line `line` of note `blockId` names (`/p/<id>/media/<line>`), when a page here shows that note: not locked;
   * inside a share's scope; on the public listener, under a note that is public now with nothing between them left out.
   * The path is the note's, read again now, and checked as an attachment is (the publish roots, nothing hidden, image
   * types only); the URL never carries one. With `image`, it is the `image`th image primitive of the component line
   * `line` draws (PIE-827), read again from its kept view.
   */
  private async serveMedia(request: Request, blockId: string, line: number, audience: PublishAudience, share?: PageShare, image?: number): Promise<Response> {
    const policy = this.requirePolicy();
    if (policy.remoteService) return notFound();
    if ((await this.lockedIds([blockId])).size) return notFound();
    if (share && !(await this.inScope([blockId], share)).has(blockId)) return notFound();
    if (audience === "public" && !share && !(await this.reachedFromPublic(blockId))) return notFound();
    const spec = image === undefined ? await this.mediaLineAt(blockId, line) : await this.componentImageAt(blockId, line, image);
    if (!spec || spec.kind !== "img") return notFound();
    const check = checkImage(spec.path, policy);
    if (!check.ok) return notFound();
    const bytes = readCheckedImage(check);
    if (!bytes) return notFound();
    return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), {
      headers: {
        ...COMMON_HEADERS, "content-type": check.mime, "content-length": String(bytes.length), "cache-control": "private, max-age=300",
        // An SVG opened on its own runs nothing.
        ...(check.mime === "image/svg+xml" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
      },
    });
  }

  /** The media line `line` of note `blockId` is, read now. */
  private async mediaLineAt(blockId: string, line: number): Promise<MediaSpec | undefined> {
    const block = (await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [blockId], fields: ["text"] })).blocks[0];
    return block ? noteMediaLines(block.text ?? "").get(line) : undefined;
  }

  /** The `image`th image primitive of the component line `line` of note `blockId` draws (PIE-827), as its kept view says now. */
  private async componentImageAt(blockId: string, line: number, image: number): Promise<MediaSpec | undefined> {
    try {
      const read = await this.client.request<ResourceProjectionReadResult>({ action: "resources.projection.read", blockId });
      const view = read.projections.find((projection) => projection.kind === "component" && projection.anchor.line === line)?.output?.component?.view;
      const node = view === undefined ? undefined : viewImages(validatePrimitive(view))[image];
      return node ? imagePrimitiveSpec(node) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Whether a public page shows `blockId`: it is a public note now, or under one with nothing between them left out. */
  private async reachedFromPublic(blockId: string): Promise<boolean> {
    const pages = new Set(audienceIndex(await this.readIndex(), "public").entries.map((entry) => entry.blockId));
    let at: string | null = blockId;
    for (let depth = 0; at && depth <= LOCK_WALK_LIMIT; depth++) {
      if (pages.has(at)) return this.stillPublic(at);
      const block: BlockReadCollection["blocks"][number] | undefined = (await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [at], fields: ["parent", "properties"] })).blocks[0];
      if (!block) return false;
      const intent = blockPublishIntent(block.properties ?? []);
      if (intent === "off" || intent === "never") return false;
      at = block.parentId ?? null;
    }
    return false;
  }

  /** Whether the block still says `[publish::public…]` now, not just when the index was built. */
  private async stillPublic(blockId: string): Promise<boolean> {
    return (await this.publicNow([blockId])).has(blockId);
  }

  /** Which of `ids` say `[publish::public…]` now: read at request time, as the lock is. */
  private async publicNow(ids: readonly string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)];
    const result = new Set<string>();
    for (let start = 0; start < unique.length; start += MAX_BLOCK_READ_IDS) {
      const read = await this.client.request<BlockReadCollection>({
        action: "blocks.read", ids: unique.slice(start, start + MAX_BLOCK_READ_IDS), fields: ["properties"],
      });
      for (const block of read.blocks) if (isPublicIntent(block.properties)) result.add(block.id);
    }
    return result;
  }

  /**
   * Which of `ids` are locked: the block or any ancestor carries
   * `[publish::never]`. Walks up one level per request, all ids together. A
   * chain it cannot finish counts as locked. A missing or trashed block isn't locked: `gone` says which those are.
   */
  private async lockedIds(ids: readonly string[], gone?: Set<string>): Promise<Set<string>> {
    const known = await this.walkUp(ids);
    // `gone`, when asked for, collects those that are missing or in Trash.
    if (gone) for (const id of ids) if (known.get(id) === null) gone.add(id);
    const decided = new Map<string, boolean>();
    const isLocked = (id: string, depth = 0): boolean => {
      const cached = decided.get(id);
      if (cached !== undefined) return cached;
      if (!known.has(id) || depth > LOCK_WALK_LIMIT) return true;
      const entry = known.get(id);
      const value = !!entry && (entry.never || (entry.parentId !== null && isLocked(entry.parentId, depth + 1)));
      decided.set(id, value);
      return value;
    };
    return new Set(ids.filter((id) => isLocked(id)));
  }

  /**
   * Which of `ids` a share shows: all of them for the whole outline; for a note, those it is, or is above (each one's
   * chain of parents reaches it). A chain the walk can't finish is outside. Locks are checked on their own.
   */
  private async inScope(ids: readonly string[], share: PageShare): Promise<Set<string>> {
    if (share.scope.kind === "outline") return new Set(ids);
    const rootId = share.scope.blockId;
    const known = await this.walkUp(ids);
    const reaches = (id: string): boolean => {
      for (let at: string | null = id, depth = 0; at && depth <= LOCK_WALK_LIMIT; depth++) {
        if (at === rootId) return true;
        at = known.get(at)?.parentId ?? null;
      }
      return false;
    };
    return new Set(ids.filter(reaches));
  }

  /**
   * The published index as a share links it: only the notes inside its scope (kept until the next change). Any other
   * note a page names stays its label, and its address answers 404 inside the share.
   */
  private async shareIndex(share: PageShare): Promise<PublishedIndex> {
    const index = await this.readIndex();
    if (share.scope.kind === "outline") return index;
    const cached = this.shareIndexes.get(share.id);
    if (cached && cached.generation === this.generation && cached.from === index) return cached.value;
    const inside = await this.inScope(index.entries.map((entry) => entry.blockId), share);
    // A note's attached file isn't served inside a share: the note is.
    const value = { ...index, entries: index.entries.filter((entry) => inside.has(entry.blockId)).map((entry) => entry.type === "block" ? entry : { ...entry, type: "block" as const }) };
    if (this.shareIndexes.size > 64) this.shareIndexes.clear();
    this.shareIndexes.set(share.id, { generation: this.generation, from: index, value });
    return value;
  }

  /** Each of `ids` and the notes above it: parent and whether it says `[publish::never]`, one level per request. */
  private async walkUp(ids: readonly string[]): Promise<Map<string, { parentId: string | null; never: boolean } | null>> {
    const known = new Map<string, { parentId: string | null; never: boolean } | null>();
    let frontier = [...new Set(ids)];
    for (let level = 0; frontier.length && level < LOCK_WALK_LIMIT; level++) {
      for (let start = 0; start < frontier.length; start += MAX_BLOCK_READ_IDS) {
        const read = await this.client.request<BlockReadCollection>({
          action: "blocks.read", ids: frontier.slice(start, start + MAX_BLOCK_READ_IDS), fields: ["parent", "properties"],
        });
        for (const block of read.blocks) {
          known.set(block.id, { parentId: block.parentId ?? null, never: blockPublishIntent(block.properties ?? []) === "never" });
        }
        // A missing or trashed block is never shown, so it locks nothing and unlocks nothing.
        for (const unavailable of read.unavailable) known.set(unavailable.id, null);
      }
      frontier = [...new Set([...known.values()]
        .map((entry) => entry?.parentId)
        .filter((parentId): parentId is string => !!parentId && !known.has(parentId)))];
    }
    return known;
  }

  /** `[[page]]` addresses in `texts` resolved through the service's page registry, a few at a time. */
  private async resolvePages(texts: readonly string[]): Promise<Map<string, string>> {
    const addresses = [...new Set(texts.flatMap((text) =>
      pageAddressReferences(text).map((reference) => reference.normalizedAddress)))].slice(0, PAGE_RESOLVE_LIMIT);
    const pages = new Map<string, string>();
    // A few at a time: a large page must not open hundreds of connections to the shared service.
    // A link that cannot be resolved shows its label, as an unpublished one does.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PAGE_RESOLVE_CONCURRENCY, addresses.length) }, async () => {
      while (next < addresses.length) {
        const address = addresses[next++]!;
        try {
          const resolution = await this.client.request<PageAddressResolution>({ action: "pages.resolve", address });
          if (resolution.status === "resolved" && resolution.block) pages.set(address, resolution.block.id);
        } catch (error) {
          this.log(`publish: pages.resolve: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }));
    return pages;
  }

  /**
   * The embeds in `texts` (in the order a page shows them), projected by the
   * service's `transclusions.read` as one document: its depth, per-document
   * count, byte budget, cycle and Trash rules apply. Then every embedded note
   * that is locked is found, so it shows as a locked note. Where marks are read (`marksReadable`: the tailnet, a share
   * that takes comments) an embedded mark is shown whoever wrote it: a reply @margin wrote is a mark, not an
   * extension's record.
   */
  private async readEmbeds(texts: readonly string[], hostBlockId: string, marksReadable: boolean, shareable?: ShareableNotes, share?: PageShare, owner = false): Promise<EmbedExpansion | undefined> {
    const targets = texts.flatMap((text) => embedMatches(text)
      .map((match) => ({ blockId: match[1]!, ...(match[2] ? { fragmentId: match[2] } : {}) })));
    if (!targets.length) return undefined;
    const read = await this.client.request<TransclusionRead>({
      action: "transclusions.read", targets: targets.slice(0, MAX_EMBEDS_PER_DOCUMENT + 1), hostBlockId,
    });
    const ids = new Set<string>();
    const visit = (node: TransclusionNode) => {
      if (node.status === "ready") ids.add(node.blockId);
      for (const inner of node.embeds ?? []) visit(inner);
    };
    for (const node of read.results) visit(node);
    const extensionBlocks = new Map([...ids].flatMap((id) => {
      const block = read.blocks[id];
      // The owner's pages show an extension's data as any note: it's his outline.
      const extension = block && !owner && !(marksReadable && isAnnotationBlock(block)) ? extensionSource(block) : undefined;
      return extension ? [[id, extension] as const] : [];
    }));
    // A public note embedded here is read again: the index may be seconds old, and `public` holds per request.
    // Inside a share of one note, an embed shows only a note inside it.
    const confirmed = shareable
      ? new Set([...shareable.shown, ...await this.publicNow([...ids].filter((id) => shareable.published.has(id) && !shareable.shown.has(id)))])
      : share?.scope.kind === "note" ? await this.inScope([...ids], share) : undefined;
    return {
      read,
      ...(confirmed ? { shareable: confirmed } : {}),
      locked: ids.size ? await this.lockedIds([...ids]) : new Set(),
      ...(extensionBlocks.size ? { extensionHidden: await this.extensionHiddenIds(extensionBlocks, hostBlockId) } : {}),
      cursor: { next: 0 },
    };
  }

  /**
   * Which embedded extension blocks stay hidden: those with no
   * `[publish.ext::<id>]` on themselves, their ancestors or the page that
   * embeds them. Walks up one level per request, as `lockedIds` does.
   */
  private async extensionHiddenIds(blocks: ReadonlyMap<string, string>, hostBlockId: string): Promise<Map<string, string>> {
    // The page that embeds them, and every block above it, may opt in.
    const chain = async (start: string) => {
      const properties: BlockProperty[][] = [];
      let frontier: string | null = start;
      for (let level = 0; frontier && level < LOCK_WALK_LIMIT; level++) {
        const read: BlockReadCollection = await this.client.request<BlockReadCollection>({
          action: "blocks.read", ids: [frontier], fields: ["parent", "properties"],
        });
        const block = read.blocks[0];
        if (!block) break;
        properties.push(block.properties ?? []);
        frontier = block.parentId ?? null;
      }
      return properties;
    };
    const host = await chain(hostBlockId);
    const hidden = new Map<string, string>();
    for (const [id, extension] of blocks) {
      const opted = host.some((properties) => publishesExtension(properties, extension)) ||
        (await chain(id)).some((properties) => publishesExtension(properties, extension));
      if (!opted) hidden.set(id, extension);
    }
    return hidden;
  }


  /**
   * The index as this page may link it: a target locked since the index was
   * built (the change feed has not caught up yet) is not linked.
   */
  private async linkable(index: PublishedIndex, texts: readonly string[], pages: ReadonlyMap<string, string>, embeds?: EmbedExpansion, audience: PublishAudience = "tailnet"): Promise<PublishedIndex> {
    const published = new Set(index.entries.map((entry) => entry.blockId));
    const embedded = embeds ? Object.values(embeds.read.blocks).map((block) => block.text) : [];
    const targets = new Set([
      ...[...texts, ...embedded].flatMap((text) => [...blockReferenceOccurrences(text)].map((occurrence) => occurrence.blockId)),
      ...pages.values(),
    ].filter((id) => published.has(id)));
    if (!targets.size) return index;
    const locked = await this.lockedIds([...targets]);
    // On a public page a link target must still be public now, not only when the index was built.
    const stillPublic = audience === "public" ? await this.publicNow([...targets]) : undefined;
    const stale = new Set(stillPublic ? [...targets].filter((id) => !stillPublic.has(id)) : []);
    return locked.size || stale.size
      ? { ...index, entries: index.entries.filter((entry) => !locked.has(entry.blockId) && !stale.has(entry.blockId)) }
      : index;
  }

  /**
   * For the public audience: the notes an embed may show, the public notes and
   * the rows this page shows anyway. Any other embed shows NOT_SHARED_NOTE.
   */
  private shareable(audience: PublishAudience, index: PublishedIndex, shownIds: readonly string[] = []): ShareableNotes | undefined {
    return audience === "public"
      ? { published: new Set(index.entries.map((entry) => entry.blockId)), shown: new Set(shownIds) }
      : undefined;
  }

  /**
   * The block and its subtree as markdown, with its links and embeds. Annotations are not rows: read as HTML
   * (`withMarks`), the open ones are drawn on their passages (`publish-marginalia.ts`).
   */
  private async blockMarkdown(
    entry: PublishedEntry, index: PublishedIndex, audience: PublishAudience, withMarks: boolean,
    options: { base?: string; whole?: ProjectedBlockCollection; browse?: boolean; owner?: boolean; format?: "markdown" | "html"; share?: PageShare; anchors?: string[] } = {},
  ): Promise<{ markdown: string; marks: PublishedAnnotation[]; index: PublishedIndex; components: string[]; anchors: string[]; steps: PublishedStep[] }> {
    const { share } = options;
    // The owner's own pages (the tailnet, signed in): `[publish::false]` and extensions' data aren't held back there.
    const owner = !!options.owner && !share;
    const base = options.base ?? share?.base ?? this.basePathFor(audience);
    const whole = options.whole ?? await this.client.request<ProjectedBlockCollection>({
      action: "blocks.query",
      query: { subtreeRootId: entry.blockId, limit: PUBLISH_QUERY_LIMIT },
      fields: ["text", "parent", "properties", "author", "revision"],
    });
    // A mark's own page shows the mark (its id opens like any block's); the marks on it are drawn on its words.
    const mark = (block: { id: string; properties?: readonly BlockProperty[] }) => block.id !== entry.blockId && isAnnotationBlock(block);
    const annotationRows = shownSubtree(whole, owner).filter((row) => !row.locked && mark(row.block));
    const subtree = { ...whole, blocks: whole.blocks.filter((block) => !mark(block)) };
    const rows = shownSubtree(subtree, owner).filter((row) => !row.locked);
    const shown = rows.map((row) => row.block.text ?? "");
    const pages = await this.resolvePages(shown);
    const marksReadable = share ? share.comments : audience === "tailnet";
    const embeds = await this.readEmbeds(shown, entry.blockId, marksReadable, this.shareable(audience, index, rows.map((row) => row.block.id)), share, owner);
    const { decorations, lines } = await this.readProjections(rows.map((row) => ({ id: row.block.id, revision: row.block.revision })));
    const marks = withMarks ? await this.readMarks(rows.map((row) => row.block), annotationRows.map((row) => row.block)) : new Map();
    const order: PublishedAnnotation[] = [];
    let linked = await this.linkable(index, shown, pages, embeds, audience);
    // On a tailnet page every note it names is a page too (PIE-782), not only published ones; so in its Markdown.
    if (options.browse || owner) linked = await this.browseIndex(linked, shown, pages, embeds);
    // Inside a share, a link goes only to a note inside it; any other is its label.
    if (share?.scope.kind === "note") {
      const inside = await this.inScope(linked.entries.map((candidate) => candidate.blockId), share);
      linked = { ...linked, entries: linked.entries.filter((candidate) => inside.has(candidate.blockId)) };
    }
    // Where the page has a search (the tailnet, a share), a #tag opens the notes carrying it (PIE-800).
    if ((audience === "tailnet" || share) && !linked.labelsOnly) linked = { ...linked, tagSearch: true };
    const components: string[] = [];
    // The page's `{{ }}`: each note's values as the service reads them, less what the page may not show (publish-values.ts).
    const valueHost = this.liveHost(audience, linked, base, share);
    const values = await readPageValues(valueHost, rows.map((row) => ({ id: row.block.id, text: row.block.text ?? "" })));
    if (embeds) {
      const embedded = Object.values(embeds.read.blocks).filter((b) => !embeds.locked.has(b.id) && !embeds.extensionHidden?.has(b.id) && (!embeds.shareable || embeds.shareable.has(b.id)));
      embeds.values = await readPageValues(valueHost, embedded.map((b) => ({ id: b.id, text: b.text ?? "" })));
    }
    const texts = new Map(rows.map((row) => [row.block.id, row.block.text ?? ""]));
    const under = await this.handlerLines(lines, texts, options.format ?? "html", components, { index: linked, basePath: base, pages });
    // An HTML page draws the built-in components (figures, links components, embedded views) from the service's
    // answers; Markdown keeps their source as written.
    let drawn = new Map<string, Map<number, DrawnComponent>>();
    // An HTML page draws each step's box as its state (publish-steps.ts); Markdown keeps the box as written. A figure's
    // check rows are steps too (PIE-864), their words drawn as the note's are.
    const steps: PublishedStep[] = [];
    if ((options.format ?? "html") === "html") {
      const host = this.liveHost(audience, linked, base, share);
      const inline = (text: string) => renderInlineHtml(publishedText(text, { index: linked, basePath: base, pages }));
      drawn = await drawNoteComponents(host, rows.map((row) => ({ id: row.block.id, text: row.block.text ?? "", revision: row.block.revision ?? 0 })), components, { id: entry.blockId, title: entry.title }, { steps, inline });
      if (embeds) embeds.views = await this.embeddedViews(host, embeds, components);
    }
    // Its images: served from this page's address when the file may leave the machine, else their words. Its artifacts
    // (PIE-793) the same, each read now for its title.
    const policy = this.policy;
    const artifacts = new Map<string, string>();
    if (!linked.labelsOnly && policy) {
      // Each file once a page, and only an HTML or SVG file without `[alt::]` read (for its <title>); never more than
      // the page draws.
      const titles = new Map<string, string | null>();
      for (const row of rows) {
        if (!/\[?artifact::/i.test(row.block.text ?? "")) continue;
        for (const [line, spec] of noteMediaLines(row.block.text ?? "")) {
          if (spec.kind !== "artifact" || artifacts.size >= MAX_PUBLISHED_COMPONENTS) continue;
          const kind = artifactKind(spec.path), key = `${spec.path}\0${spec.alt ?? ""}`;
          if (!titles.has(key)) {
            const check = kind ? checkAttachment(spec.path, policy) : null;
            const runs = !!check?.ok && (check.type === "html" || check.type === "react" || check.type === "svg" || check.type === "mermaid");
            const read = runs && !spec.alt && (kind === "html" || kind === "svg") ? await this.readArtifact(spec, policy) : null;
            titles.set(key, runs ? artifactTitle(spec, read?.text) : null);
          }
          const title = titles.get(key);
          if (title) artifacts.set(`${row.block.id}:${line}`, title);
        }
      }
    }
    drawNoteMedia(rows.map((row) => ({ id: row.block.id, text: row.block.text ?? "" })), options.format ?? "html", components, drawn,
      (blockId, line, spec) => spec.kind === "artifact"
        ? (artifacts.has(`${blockId}:${line}`) ? `${base}${artifactPagePath(blockId, line)}` : null)
        : !linked.labelsOnly && policy && checkImage(spec.path, policy).ok ? `${base}${mediaPath(blockId, line)}` : null,
      { id: entry.blockId, title: entry.title }, (blockId, line, spec) => artifacts.get(`${blockId}:${line}`) ?? artifactTitle(spec));
    // HTML pages carry source-line destinations; only tailnet pages also identify blocks for presence.
    const anchors = options.anchors;
    const markdown = renderSubtreeMarkdown(subtree, linked, base, pages, embeds, decorations, marks, order, under, (options.format ?? "html") === "html" ? anchors : undefined, drawn, owner, (options.format ?? "html") === "html" ? steps : undefined, !!options.browse, values);
    return { markdown, marks: order, index: linked, components, anchors: anchors ?? [], steps };
  }

  /**
   * What a page's built-in components may ask and show (src/publish-live.ts): the service, the notes this page shows
   * (never a locked one; inside a narrowed share only its notes; on a public page only public ones), their titles, and
   * where each opens from here.
   */
  private liveHost(audience: PublishAudience, index: PublishedIndex, base: string, share?: PageShare): LiveHost {
    return {
      request: (request) => this.client.request(request as never),
      // A note in Trash is never a row: a view of deleted notes (Trash itself) draws none of them.
      shown: async (ids) => {
        let open = [...await this.openIds(ids, share)];
        if (!share && audience === "public") { const shared = await this.publicNow(open); open = open.filter((id) => shared.has(id)); }
        return new Set(open);
      },
      titles: async (ids) => new Map([...await this.titles([...new Set(ids)])].map(([id, title]) => [id, noteTitle(title)])),
      href: (blockId) => {
        const published = index.entries.find((candidate) => candidate.blockId === blockId);
        if (published && !index.labelsOnly) return `${base}${published.path}`;
        // A public page links only to published notes; a tailnet page (and a share's) to any note it shows.
        return audience === "public" && !share ? null : `${base}/p/${encodeURIComponent(blockId)}`;
      },
    };
  }

  /** The views a page embeds (`!((view))`), each drawn as its lane: by view id, its component's sentinel. */
  private async embeddedViews(host: LiveHost, embeds: EmbedExpansion, components: string[]): Promise<Map<string, string>> {
    const views = new Map<string, string>();
    const wanted = embeds.read.results.filter((node) => node.kind === "view" && node.status === "ready" && !embeds.locked.has(node.blockId) && (!embeds.shareable || embeds.shareable.has(node.blockId)));
    for (const node of wanted) {
      if (views.has(node.blockId) || components.length >= MAX_PUBLISHED_COMPONENTS) continue;
      const block = embeds.read.blocks[node.blockId];
      const title = noteTitle(node.title ?? "") || "a view";
      components.push(await drawViewLane(host, { id: node.blockId, properties: block?.properties ?? (await this.client.request<BlockReadCollection>({ action: "blocks.read", ids: [node.blockId], fields: ["properties"] })).blocks[0]?.properties ?? [] }, title));
      views.set(node.blockId, componentSentinel(components.length - 1));
    }
    return views;
  }

  /**
   * What each extension handler line on the page shows, under the line (its `key::` line is a property, which a page
   * doesn't show): an output's Markdown; a component's HTML (`extensions.render`, with its Blockdown read by this
   * page's reader), or in Markdown its Markdown target; and a line with nothing to show yet, its source as code.
   */
  private async handlerLines(
    lines: ReadonlyMap<string, readonly ResourceProjection[]>, texts: ReadonlyMap<string, string>, format: "markdown" | "html",
    components: string[], context: TextContext,
  ): Promise<Map<string, Map<number, string>>> {
    const out = new Map<string, Map<number, string>>();
    // A section's callouts draw as the page's do.
    const callouts = lines.size && format === "html" ? await this.callouts() : BUILTIN_CALLOUT_REGISTRY;
    for (const [blockId, projections] of lines) {
      const html = format === "html" && projections.some((projection) => projection.kind === "component" && hasResult(projection))
        ? await this.client.request<{ results: { line: number; rendered: { body: string } }[] }>({ action: "extensions.render", blockId, target: "html" })
          .then((answer) => answer.results, () => [])
        : [];
      const text = (texts.get(blockId) ?? "").split("\n");
      const shown = new Map<number, string>();
      for (const projection of projections) {
        const line = projection.anchor.line, output = hasResult(projection) ? projection.output : undefined;
        const body = projection.kind === "component" ? html.find((result) => result.line === line)?.rendered.body : undefined;
        if (body !== undefined && components.length < MAX_PUBLISHED_COMPONENTS) {
          // Its pictures as the page's own images (PIE-827): served from here when the file may leave the machine.
          const images = this.componentImages(projection);
          const policy = this.policy;
          components.push(readImages(readBlockdown(body, (source) => renderMarkdownHtml(publishedText(source, context), callouts)), (n) => {
            const node = images[n];
            if (!node) return null;
            const spec = imagePrimitiveSpec(node);
            // `caption: false` (PIE-839): a served cover without its caption; one not served still says what it is.
            return mediaHtml(spec, !context.index.labelsOnly && policy && checkImage(spec.path, policy).ok ? `${context.basePath}${mediaPath(blockId, line, n)}` : null, undefined, node.caption !== false);
          }));
          shown.set(line, componentSentinel(components.length - 1));
        } else if (output?.markdown.trim()) shown.set(line, output.markdown);
        else shown.set(line, lineSource(text[line] ?? projection.propertyKey));
      }
      out.set(blockId, shown);
    }
    return out;
  }

  /** A component line's image primitives, in the order its HTML numbers them; none when its view can't be read. */
  private componentImages(projection: ResourceProjection) {
    try {
      const view = projection.output?.component?.view;
      return view === undefined ? [] : viewImages(validatePrimitive(view));
    } catch {
      return [];
    }
  }

  /**
   * The open annotations on each shown block that has any (its annotation blocks are its children), read through
   * `annotations.list`. A block whose read fails is published unmarked: a mark is never what a page depends on.
   */
  private async readMarks(blocks: readonly ProjectedVisibleBlock[], annotations: readonly ProjectedVisibleBlock[]): Promise<ReadonlyMap<string, readonly PublishedAnnotation[]>> {
    const shown = new Set(annotations.map((block) => block.id));
    const annotated = new Set(annotations.map((block) => block.parentId));
    const out = new Map<string, readonly PublishedAnnotation[]>();
    await Promise.all(blocks.filter((block) => annotated.has(block.id)).slice(0, MAX_DECORATED_BLOCKS).map(async (block) => {
      try {
        const threads = await this.client.request<AnnotationThread[]>({
          action: "annotations.list", query: { subject: { kind: "block", blockId: block.id }, includeResolved: true },
        });
        const marks = publishedAnnotations(block.text ?? "", threads.filter((thread) => {
          const subject = thread.resolvedTarget?.representation.subject;
          return subject?.kind === "block" && subject.blockId === block.id;
        }), shown);
        if (marks.length) out.set(block.id, marks);
      } catch (error) {
        this.log(`publish: annotations.list: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    return out;
  }

  /**
   * What the rules draw on each shown block (PIE-600) and its extension handler lines, as the service answers
   * `resources.projection.read`. A block whose read fails is published as written: neither is what a page depends on.
   */
  private async readProjections(rows: readonly { id: string; revision?: number }[]): Promise<{
    decorations: ReadonlyMap<string, readonly Decoration[]>; lines: ReadonlyMap<string, readonly ResourceProjection[]>;
  }> {
    const decorations = new Map<string, readonly Decoration[]>(), lines = new Map<string, readonly ResourceProjection[]>();
    const revisions = new Map(rows.map((row) => [row.id, row.revision]));
    await Promise.all(rows.slice(0, MAX_DECORATED_BLOCKS).map(async ({ id: blockId }) => {
      try {
        const read = await this.client.request<ResourceProjectionReadResult>({ action: "resources.projection.read", blockId });
        // Placed by line: only against the revision this page shows (an edit since would move them).
        if (read.revision !== revisions.get(blockId)) return;
        if (read.decorations?.length) decorations.set(blockId, read.decorations);
        const drawn = read.projections.filter(drawnLine);
        if (drawn.length) lines.set(blockId, drawn);
      } catch { /* published as written */ }
    }));
    return { decorations, lines };
  }

  /** An attached markdown file rendered: its `((block))` and `[[page]]` links and its embeds, as a block's. */
  private async attachedMarkdown(entry: PublishedEntry, index: PublishedIndex, text: string, audience: PublishAudience): Promise<string> {
    const pages = await this.resolvePages([text]);
    const embeds = await this.readEmbeds([text], entry.blockId, audience === "tailnet", this.shareable(audience, index, [entry.blockId]), undefined, audience === "tailnet");
    const linkable = await this.linkable(index, [text], pages, embeds, audience);
    return publishedText(text, { index: linkable, basePath: this.basePathFor(audience), pages, ...(embeds ? { embeds } : {}) }, { keepProperties: true });
  }
}

export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^\/[A-Za-z0-9._~@/-]*$/.test(trimmed) || trimmed.split("/").some((segment) => segment === "..")) {
    throw new Error(`--base-path must be a URL path such as /pub: ${value}`);
  }
  return trimmed;
}

/** For a public page: the public notes in the index, and the rows the page shows anyway. */
interface ShareableNotes {
  published: ReadonlySet<string>;
  shown: ReadonlySet<string>;
}

/** Embeds on one published page: the service's projection, which of its notes are locked, and how many are used. */
export interface EmbedExpansion {
  read: TransclusionRead;
  locked: ReadonlySet<string>;
  /** Embedded extension blocks nothing opted in, by id, with their extension. */
  extensionHidden?: ReadonlyMap<string, string>;
  /**
   * On a public page: the only notes an embed may show. Any other ready embed
   * shows NOT_SHARED_NOTE, never its text, title or id.
   */
  shareable?: ReadonlySet<string>;
  /** Embedded views drawn as lanes (`!((view))`), by view id: each its component's sentinel. */
  views?: ReadonlyMap<string, string>;
  /** The `{{ }}` of the embedded notes, as the page may show them (publish-values.ts), by note id. */
  values?: ReadonlyMap<string, readonly SiteValue[]>;
  cursor: { next: number };
}

interface TextContext {
  index: PublishedIndex;
  basePath: string;
  pages: ReadonlyMap<string, string>;
  embeds?: EmbedExpansion;
}

/** Where a text's embeds come from: the page's top-level projection in order, or an embedded note's own. */
interface EmbedSource {
  nodes: readonly TransclusionNode[];
  cursor: { next: number };
  /** The whole note a fragment's text was sliced from, and its first line there (code is judged in the note). */
  note?: string;
  firstLine?: number;
}

function lineOf(text: string, offset: number): number {
  let line = 0;
  for (let at = text.indexOf("\n"); at >= 0 && at < offset; at = text.indexOf("\n", at + 1)) line++;
  return line;
}

/** A note's text with its `{{ }}` as the page may show them: the value, `hidden here` where it read a note the page may not show, else as typed. */
function valuedText(text: string, values: readonly SiteValue[]): string {
  return substituteValues(text, values, { words: publishedValueWords, hidden: () => placeholder("hidden here") });
}

/** Markdown emphasis for a fixed placeholder such as "locked note". */
const placeholder = (text: string) => `*${text}*`;

/** An embedded note (or why it is not shown) as markdown, before it is quoted. */
function renderEmbed(node: TransclusionNode | undefined, context: TextContext): string {
  const expansion = context.embeds!;
  if (!node) return placeholder(TRANSCLUSION_WORDING.limit);
  // On a public page an embed of a note that isn't public names nothing from it, whatever its state.
  if (expansion.shareable && !expansion.shareable.has(node.blockId)) return placeholder(NOT_SHARED_NOTE);
  if (node.status !== "ready") {
    // Wording that names nothing from the target: a trashed note's title is not shown.
    if (node.status === "deleted") return placeholder("note in Trash");
    if (node.status === "missing") return placeholder("missing note");
    if (node.status === "failed") return placeholder("embed failed");
    return placeholder(node.message ?? "not shown");
  }
  if (expansion.locked.has(node.blockId)) return placeholder(LOCKED_NOTE);
  const hidden = expansion.extensionHidden?.get(node.blockId);
  if (hidden) return placeholder(EXTENSION_HIDDEN(hidden));
  if (node.kind === "view") return expansion.views?.get(node.blockId) ?? placeholder("a view, not drawn here");
  const block = expansion.read.blocks[node.blockId];
  if (!block) return placeholder("missing note");
  // A mark shows its own words, from its title's line: not its generated heading and the store's line under it.
  const from = !node.fragment && isAnnotationBlock(block) ? markTitleLine(block.text)?.line ?? 0 : 0;
  // Anchors (`^spring`) are hidden as a fragment's text hides them; the lines stay line for line.
  const raw = node.fragment ? node.fragment.text : stripFragmentAnchors(from ? block.text.split("\n").slice(from).join("\n") : block.text);
  const values = expansion.values?.get(node.blockId);
  const text = values ? valuedText(raw, values) : raw;
  return publishedText(text, context, {}, {
    nodes: node.embeds ?? [], cursor: { next: 0 }, note: block.text, firstLine: node.fragment?.startLine ?? from,
  }) || placeholder("empty note");
}

const quote = (markdown: string) => markdown.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
const EMBED_SENTINEL = /[ \t]*\u0000(\d+)\u0000[ \t]*/g;

/**
 * Text for publication: property tokens removed (unless `keepProperties`, for
 * an attached markdown file); a `((block))` or `[[page]]` link becomes a link
 * when its target is published, and otherwise only its authored label (never
 * the target's text). An embed `!((id))` / `!((id^anchor))` shows the embedded
 * note's text as a quote, published or not (a locked note shows "locked
 * note"). Links and embeds written in code stay as written.
 */
function publishedText(text: string, context: TextContext, options: { keepProperties?: boolean; title?: boolean } = {}, source?: EmbedSource): string {
  const { index, basePath, pages, embeds } = context;
  let body = text;
  // Embeds first, in order, so each takes the projection read for its place.
  const rendered: string[] = [];
  const matches = embeds ? embedMatches(body, source?.note ?? body, source?.firstLine ?? 0) : [];
  const from = source ?? (embeds ? { nodes: embeds.read.results, cursor: embeds.cursor } : undefined);
  for (let at = 0; from && at < matches.length; at++) rendered.push(renderEmbed(from.nodes[from.cursor.next++], context));
  for (let at = matches.length - 1; at >= 0; at--) {
    const match = matches[at]!;
    body = body.slice(0, match.index) + `\u0000${at}\u0000` + body.slice(match.index + match[0].length);
  }
  // The block-level tags (PIE-880: the hashtags written on the metadata lines) are one row under the title, so taking the
  // properties out doesn't leave them as a stray line; outline-core's blockTags says which they are. Read first, before
  // anything rewrites a metadata line (a `[from::]` or `[file::]` there).
  let tagRow = "";
  if (!options.keepProperties && body.includes("#")) {
    const records = parsePropertyRecords(body);
    tagRow = blockTags(body, records).tags.map((tag) => `#${tag}`).join(" ");
    // Every tag on a metadata line goes from it; the row holds the ones no hand-made first line already shows.
    const hidden = metadataLines(body, records);
    for (const record of records.filter((r) => r.syntax === "hashtag" && hidden.has(r.line)).reverse()) body = body.slice(0, record.start) + body.slice(record.end);
  }
  // A button (PIE-957) is inert on a page (ADR 0005, readers read): its label, never the line it would run. A `::button{…}` is
  // one line with no closing `::`, which the component reader leaves as plain text; and `[label](act: …)` has a space in its
  // destination, which Markdown leaves as text. Either stands as its label here. (A line may end in a sentinel a block's
  // address rides on; it is kept.)
  if (body.includes("::button") || body.includes("(act:")) {
    const lines = body.split("\n"), fenced = new Set<number>();
    for (const f of noteCodeFences(lines)) for (let j = f.start; j <= f.end; j++) fenced.add(j);
    lines.forEach((raw, i) => {
      if (fenced.has(i)) return;
      const sentinel = /[\ue000-\uf8ff].*$/s.exec(raw), text = sentinel ? raw.slice(0, sentinel.index) : raw, tail = sentinel?.[0] ?? "";
      const button = text.includes("::button") ? buttonCallAt([text], 0) : null;
      if (button) { lines[i] = `**${button.label.replace(/[*_`\\[\]]/g, "")}**${tail}`; return; }
      if (!text.includes("(act:")) return;
      let out = text;
      for (const l of linkOccurrences(text, "inline").flatMap(l => (l.kind === "markdown" && /^act:/.test(l.url.trim()) ? [l] : [])).reverse()) out = out.slice(0, l.start) + l.text + out.slice(l.end);
      lines[i] = out + tail;
    });
    body = lines.join("\n");
  }
  // A media line no component drew (in an embed, or past a page's limit) is its alt text and its file's name, never an
  // empty bullet and never its path.
  if (!options.keepProperties) {
    const media = noteMediaLines(body);
    if (media.size) body = body.split("\n").map((line, at) => { const spec = media.get(at); return spec ? line.replace(/^(\s*(?:[-*]\s+)?).*$/, `$1${mediaMarkdown(spec, null)}`) : line; }).join("\n");
  }
  // A `[file::path]` is a file on the note: shown by its name, never its path, and a link when the note it belongs to is
  // published as that file. (Taken out before the property tokens go, which would drop it without a word.)
  const files: string[] = [];
  if (!options.keepProperties) {
    const found = parsePropertyRecords(body).filter((record) => record.key === "file" && record.syntax !== "hashtag" && !(options.title && record.line === 0)).reverse();
    for (const record of found) {
      files.unshift(record.value);
      body = body.slice(0, record.start) + `\u0003${found.length - files.length}\u0003` + body.slice(record.end);
    }
  }
  // A quote's back-link (`[from::((mark))]`, marks.quote) is where it came from: drawn as `from <link>`, one line.
  if (!options.keepProperties) {
    const from = parsePropertyRecords(body).filter((record) => record.key === "from" && record.syntax === "bracket" && /^\(\([^()]+\)\)$/.test(record.value.trim())).reverse();
    for (const record of from) {
      const first = !from.some((other) => other.line === record.line && other.start < record.start);
      body = body.slice(0, record.start) + `${first ? "from" : "·"} ${record.value.trim()}` + body.slice(record.end);
    }
  }
  if (!options.keepProperties) {
    body = stripPropertyTokens(body).split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n");
    // A line's `^anchor` is the outline's address for it, not something a reader reads.
    const anchored = codeLineSet(body);
    const plain = stripFragmentAnchors(body).split("\n");
    body = body.split("\n").map((line, at) => (anchored.has(at) ? line : plain[at]!.replace(/[ \t]+$/, ""))).join("\n");
  }
  if (tagRow) {
    const lines = body.split("\n");
    const subject = Math.max(0, lines.findIndex((line) => line.trim()));
    body = [...lines.slice(0, subject + 1), "", tagRow, "", ...lines.slice(subject + 1)].join("\n");
  }
  // A #tag is a link to the notes carrying it (PIE-800), where the page has a search; never one inside a link's label.
  if (index.tagSearch && !options.keepProperties) {
    const inLink = [...blockReferenceOccurrences(body), ...pageAddressReferences(body)];
    const tags = parsePropertyRecords(body).filter((record) => record.syntax === "hashtag" && !inLink.some((link) => record.start >= link.start && record.start < link.end));
    for (const tag of tags.reverse()) body = body.slice(0, tag.start) + `[${tag.raw}](${tagHref(basePath, tag.value)})` + body.slice(tag.end);
  }
  // Replacing links never adds or removes a line, so the code lines stay where they are.
  const code = codeLineSet(body);
  const inCode = (offset: number) => code.has(lineOf(body, offset));
  const byId = new Map(index.entries.map((entry) => [entry.blockId, entry]));
  const link = (label: string, target: PublishedEntry | undefined, fragment?: string) =>
    target && !index.labelsOnly ? `[${label}](${basePath}${target.path}${fragment ? `#${encodeURIComponent(fragment)}` : ""})` : label;
  // Without an embed projection (a caller that has none), an embed reads as a link, never as
  // `![…](…)`, which markdown takes for an image.
  const embedStarts = new Set(embeds ? [] : embedMatches(body).map((match) => match.index));
  for (const occurrence of [...blockReferenceOccurrences(body)].reverse()) {
    if (inCode(occurrence.start)) continue;
    const target = byId.get(occurrence.blockId);
    const replacement = link(occurrence.label?.trim() || target?.title || "unpublished note", target, occurrence.fragmentId);
    const start = embedStarts.has(occurrence.start - 1) ? occurrence.start - 1 : occurrence.start;
    body = body.slice(0, start) + replacement + body.slice(occurrence.end);
  }
  // A page link another holds (PIE-592) is part of that one's text.
  for (const reference of pageAddressReferences(body).filter((page) => !page.nested).reverse()) {
    if (inCode(reference.start)) continue;
    const blockId = pages.get(reference.normalizedAddress);
    const replacement = link(reference.label ?? pageAddressText(reference.displayAddress), blockId ? byId.get(blockId) : undefined);
    body = body.slice(0, reference.start) + replacement + body.slice(reference.end);
  }
  body = body.replace(/\u0003(\d+)\u0003/g, (_, at: string) => fileChip(files[Number(at)] ?? "", index, basePath));
  // An embedded view is drawn as its lane, not quoted.
  body = body.replace(EMBED_SENTINEL, (_, at: string) => { const shown = rendered[Number(at)] ?? ""; return `\n\n${isComponentSentinel(shown) ? shown : quote(shown)}\n\n`; });
  return body.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

/** Where a `#tag` opens: the page's search for it, which lists the notes carrying it (publish-search.ts `tagOf`). */
export const tagHref = (basePath: string, tag: string) => `${basePath}/search?q=${encodeURIComponent(`#${tag}`)}`;

/** A `[file::path]` as Markdown: its name in code (the path stays where it is), linked when a published note serves that file. */
function fileChip(source: string, index: PublishedIndex, basePath: string): string {
  const name = source.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.replace(/`/g, "'") || "file";
  const served = index.entries.find((entry) => entry.attachment?.source === source && !entry.attachment.refused);
  return served && !index.labelsOnly ? `[\`${name}\`](${basePath}${served.path})` : `\`${name}\``;
}

/** A block id as an address (`/p/<id>`), told from a page name before anything is asked. */
const BLOCK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A folder page lists at most this many children, and counts what's inside the first this many. */
const MAX_LISTED_CHILDREN = 500;
/** Recent replies lists at most this many. */
const MAX_RECENT_REPLIES = 60;
const MAX_COUNTED_CHILDREN = 200;

/** A note's title (the service's) as a tailnet page shows it: a reference read as its label, a heading's marks left out. */
function noteTitle(title: string): string {
  return plainBody(title).replace(/^\s*#{1,6}\s+/, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Where a note is on the tailnet (PIE-782): its published path, else its page name, else its id. A page name is
 * looked up through the service's page registry when it's opened.
 */
function notePath(block: { id: string; properties?: readonly BlockProperty[] }, index: PublishedIndex): string {
  const published = index.entries.find((entry) => entry.blockId === block.id);
  if (published) return published.path;
  const page = getProperty([...(block.properties ?? [])], "page")?.trim();
  // A page name a published slug already answers to would open that note instead: then the id.
  const free = page && tryNormalizePageAddress(page) && !index.entries.some((entry) => entry.slug === page || entry.blockId === page);
  return `/p/${free ? encodeURIComponent(page) : block.id}`;
}

/** A note that isn't published, as a tailnet page serves it (and links to it). */
function browseEntry(block: ProjectedBlock, index: PublishedIndex): PublishedEntry {
  const path = notePath(block, index);
  return { blockId: block.id, title: noteTitle(block.title ?? "") || block.id, path, slug: decodeURIComponent(path.slice(3)), type: "block", updatedAt: block.updatedAt ?? "" };
}

/** The line a folder row summarises a note by: its first line of text after the title. */
function summarySource(text: string): string | undefined {
  return text.split("\n").slice(1).find((raw) => !/^`{3,}|^~{3,}/.test(raw.trim()) && summaryWords(raw));
}

/** A note's summary line in a folder: its summary source as words (a reference or an embed by its note's title), cut short. */
function summaryLine(text: string, links: ReadonlyMap<string, LinkedNote>): string {
  const raw = summarySource(text);
  const line = raw ? summaryWords(raw, (id) => links.get(id)?.title) : "";
  return line.length > 160 ? `${line.slice(0, 159).trimEnd()}…` : line;
}

/** A note a folder row names, as `linkableNotes` gives it: its title, and its page unless it's locked or outside a share. */
type LinkedNote = { title: string; href: string | null };

/** The properties a folder row shows: its first three, the page address and publish intent left out. */
const rowProperties = (child: Block) => child.properties.filter((property) => property.key !== "page" && property.key !== PUBLISH_PROPERTY).slice(0, 3);

/** The notes a folder row names: in its summary line and its shown properties' values. */
function rowReferences(child: Block): string[] {
  return [summarySource(child.text) ?? "", ...rowProperties(child).map((property) => property.value)]
    .flatMap((text) => blockReferenceOccurrences(text).map((reference) => reference.blockId));
}

/** A property value in a row's meta line: each reference a link labelled by its note's words, as the body draws it. */
function metaValue(value: string, links: ReadonlyMap<string, LinkedNote>): string {
  let out = "", cursor = 0;
  for (const reference of blockReferenceOccurrences(value)) {
    const note = links.get(reference.blockId);
    const label = reference.label ?? note?.title ?? "a note";
    out += escapeHtml(value.slice(cursor, reference.start)) +
      (note?.href ? `<a href="${escapeHtml(note.href)}">${escapeHtml(label)}</a>` : escapeHtml(label));
    cursor = reference.end;
  }
  return out + escapeHtml(value.slice(cursor));
}

/**
 * One child in a folder: its title and a summary line (the row's link), then what's inside, when it changed and its
 * first properties. The meta line is outside the row's link, so a reference in it can be a link of its own.
 */
function folderRow(child: Block, serviceTitle: string, index: PublishedIndex, basePath: string, count: number | undefined, links: ReadonlyMap<string, LinkedNote>): string {
  if (blockPublishIntent(child.properties) === "never") return `<li class="locked">${escapeHtml(LOCKED_NOTE)}</li>`;
  // `data-block`: the page's script finds the row by its note (ep0ch.view(), ep0ch.reveal()).
  // A note that is an image line names its picture by its alt text or its file's name, never its path.
  const image = noteMediaLines(child.text.split("\n")[0] ?? "").get(0);
  const title = image ? `${image.kind === "video" ? "video" : "image"}: ${image.alt || fileName(image.path)}` : noteTitle(serviceTitle) || "untitled";
  const summary = summaryLine(child.text, links);
  const properties = rowProperties(child).filter((property) => !image || !MEDIA_KEYS.has(property.key.toLowerCase())).map((property) => `${escapeHtml(property.key)}: ${metaValue(property.value, links)}`);
  const meta = [count ? `${count} ${count === 1 ? "note" : "notes"}` : "", escapeHtml(child.updatedAt.slice(0, 10)), ...properties].filter(Boolean).join(" · ");
  return `<li data-block="${escapeHtml(child.id)}"><a href="${escapeHtml(`${basePath}${notePath(child, index)}`)}"><span class="t">${escapeHtml(title)}</span>` +
    `${summary ? `<span class="s">${escapeHtml(summary)}</span>` : ""}</a><span class="m">${meta}</span></li>`;
}

/** The keys of a media line, which a folder row of an image note doesn't list as its properties. */
const MEDIA_KEYS = new Set<string>(["img", "image", "video", ...MEDIA_ATTRS]);

/** At most this many blocks of one page are asked for their decorations. */
const MAX_DECORATED_BLOCKS = 200;

/**
 * A block's text with what the rules draw on it (PIE-600), as Markdown: the publisher's text fallback for the view
 * primitives (a band is its heading, a card its title and fields). A decoration of the whole block goes under its
 * title (or at its end); one of a construct or a line above or below it, in its place, or (around) with its title
 * above. One not drawn yet leaves the text as written. The service made the Markdown inert, so it adds no
 * properties or links.
 */
export function decoratedText(text: string, decorations: readonly Decoration[] | undefined, under?: ReadonlyMap<number, string>, drawn?: ReadonlyMap<number, DrawnComponent>, addresses?: ReadonlyMap<number, readonly number[]>): string {
  if (!decorations?.length && !under?.size && !drawn?.size && !addresses?.size) return text;
  const code = addresses ? codeLineSet(text) : new Set<number>();
  const plain = addresses ? stripFragmentAnchors(text).split("\n") : [];
  const lines = text.split("\n").map((line, at) => addresses && !code.has(at) ? plain[at]! : line);
  const block = (decoration: Decoration) => ["", ...decoration.markdown!.split("\n"), ""];
  // Placed against the text as written, then emitted once: the first rule to take a line's place has it, as in the door.
  const before = lines.map((): string[][] => []), after = lines.map((): string[][] => []);
  const head: string[][] = [], tail: string[][] = [];
  const replaced = new Map<number, { end: number; lines: string[] }>();
  const taken = (from: number, to: number) => [...replaced].some(([at, r]) => from < r.end && at < to);
  // What a handler line shows goes right under it (src/publish-components.ts).
  for (const [line, shown] of under ?? []) if (line < lines.length) after[line]!.push(["", ...shown.split("\n"), ""]);
  // A built-in component (a figure, a links component: src/publish-live.ts) takes its lines' place first.
  for (const [line, component] of drawn ?? []) if (line < lines.length) replaced.set(line, { end: Math.min(component.end, lines.length), lines: ["", ...component.markdown.split("\n"), ""] });
  for (const decoration of decorations ?? []) {
    if ((decoration.status !== "ready" && decoration.status !== "stale") || !decoration.markdown?.trim()) continue;
    const { at, line } = decoration.hit, end = Math.min(decoration.hit.end, lines.length);
    if (at === "block") { (decoration.place === "append" ? tail : head).push(block(decoration)); continue; }
    if (line >= lines.length || end <= line) continue;
    if (decoration.place === "replace" && !taken(line, end)) replaced.set(line, { end, lines: block(decoration) });
    else if (decoration.place === "append") after[end - 1]!.push(block(decoration));
    else if (decoration.place === "around") { if (decoration.title) before[line]!.push(["", `**${decoration.title.replace(/[*_`\\[\]]/g, "")}**`]); }
    else before[line]!.push(block(decoration));
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const group of before[i]!) out.push(...group);
    const replacing = replaced.get(i);
    if (replacing) {
      const markers = Array.from({ length: replacing.end - i }, (_, n) => addresses?.get(i + n) ?? []).flat();
      out.push(...replacing.lines);
      if (markers.length) out.push(replacementAddresses(markers));
      for (let j = i; j < replacing.end; j++) for (const group of after[j]!) out.push(...group);
      i = replacing.end - 1;
    } else {
      out.push((addresses?.get(i) ?? []).reduce((line, at) => placeAnchor(line, at, code.has(i)), lines[i]!));
      for (const group of after[i]!) out.push(...group);
    }
    // The block's own decorations go under its title.
    if (i === 0) for (const group of head) out.push(...group);
  }
  for (const group of tail) out.push(...group);
  return out.join("\n");
}

/**
 * A published block's title as readers see it: a `((ref))` shows its authored
 * label, else a published target's title, else "unpublished note" — never an
 * unpublished block's id or text. `[[page]]` links keep their authored text.
 */
function publishedTitle(rawTitle: string, publishedTitles: ReadonlyMap<string, string>, depth = 0): string {
  let title = rawTitle;
  for (const occurrence of [...blockReferenceOccurrences(title)].reverse()) {
    const target = publishedTitles.get(occurrence.blockId);
    const replacement = occurrence.label?.trim() ||
      (target !== undefined && depth < 1 ? publishedTitle(target, publishedTitles, depth + 1) : target !== undefined ? "note" : "unpublished note");
    const start = title[occurrence.start - 1] === "!" ? occurrence.start - 1 : occurrence.start;
    title = title.slice(0, start) + replacement + title.slice(occurrence.end);
  }
  return title.replace(/\s{2,}/g, " ").trim();
}

/** The index as served over HTTP: without the authored attachment paths, which say where files live. */
function readerIndex(index: PublishedIndex): PublishedIndex {
  return {
    ...index,
    entries: index.entries.map(({ attachment, ...entry }) =>
      attachment?.refused ? { ...entry, attachment: { refused: attachment.refused } } : entry),
  };
}

/** One of the outline's own views (`[system-view::trash]`, `bookmarks`): the service keeps it, nobody wrote it to read. */
function isSystemView(block: Block): boolean {
  return isVirtualBranchDefinition(block) && !!getProperty(block.properties, "system-view");
}

/** An annotation or a reply: drawn on its passage, never listed as a row of the note. */
function isAnnotationBlock(block: { properties?: readonly BlockProperty[] }): boolean {
  const type = getProperty(block.properties ?? [], "type");
  return type === ANNOTATION_TYPE || type === ANNOTATION_REPLY_TYPE;
}

/**
 * The rows of a published subtree in page order: the root, then each
 * descendant that is shown. A descendant marked `[publish::false]` (or
 * no/off/0) is left out with its own subtree; one marked `[publish::never]`
 * is a locked row (its place says "locked note") and its subtree is left out.
 * A block whose chain to the root is not in the result is left out. Decided
 * per block, not by result order. For the `owner` (his own pages on the tailnet or signed in) only the `never` lock
 * holds: a `[publish::false]` block and an extension's records are shown as any other.
 */
export function shownSubtree(subtree: ProjectedBlockCollection, owner = false): Array<{ block: ProjectedVisibleBlock; locked: boolean }> {
  const [root, ...descendants] = subtree.blocks;
  if (!root) return [];
  const byId = new Map(subtree.blocks.map((block) => [block.id, block]));
  type Decision = "shown" | "locked" | "hidden";
  const decided = new Map<string, Decision>([[root.id, "shown"]]);
  const decide = (block: ProjectedVisibleBlock): Decision => {
    const known = decided.get(block.id);
    if (known !== undefined) return known;
    decided.set(block.id, "hidden"); // a cycle is never shown
    const parent = block.parentId ? byId.get(block.parentId) : undefined;
    const intent = blockPublishIntent(block.properties ?? []);
    const extension = extensionSource(block);
    const optedIn = (id: string | null | undefined, depth = 0): boolean => {
      const at = id ? byId.get(id) : undefined;
      return !!at && depth <= subtree.blocks.length &&
        (publishesExtension(at.properties ?? [], extension!) || optedIn(at.parentId, depth + 1));
    };
    const value: Decision = parent === undefined || decide(parent) !== "shown" || (intent === "off" && !owner) ? "hidden"
      // An extension's annotation (marginalia's highlight) is a mark on the words, not a record the extension keeps.
      : extension && !owner && !isAnnotationBlock(block) && !optedIn(block.id) ? "hidden"
      : intent === "never" ? "locked" : "shown";
    decided.set(block.id, value);
    return value;
  };
  return [{ block: root, locked: false }, ...descendants
    .map((block) => ({ block, decision: decide(block) }))
    .filter((row) => row.decision !== "hidden")
    .map((row) => ({ block: row.block, locked: row.decision === "locked" }))];
}

/**
 * Publishing covers the block and its subtree (see `shownSubtree`). The
 * block's own text comes first (its first line as the heading); descendants
 * follow as a nested list, as they sit in the outline. Trash is never included.
 */
export function renderSubtreeMarkdown(
  subtree: ProjectedBlockCollection,
  index: PublishedIndex,
  basePath = "",
  pages: ReadonlyMap<string, string> = new Map(),
  embeds?: EmbedExpansion,
  decorations: ReadonlyMap<string, readonly Decoration[]> = new Map(),
  marks: ReadonlyMap<string, readonly PublishedAnnotation[]> = new Map(),
  order: PublishedAnnotation[] = [],
  under: ReadonlyMap<string, ReadonlyMap<number, string>> = new Map(),
  anchors?: string[],
  drawn: ReadonlyMap<string, ReadonlyMap<number, DrawnComponent>> = new Map(),
  owner = false,
  steps?: PublishedStep[],
  blockAnchors = true,
  values: ReadonlyMap<string, readonly SiteValue[]> = new Map(),
): string {
  const [rootRow, ...rows] = shownSubtree(subtree, owner);
  if (!rootRow) return "";
  const root = rootRow.block;
  const context: TextContext = { index, basePath, pages, ...(embeds ? { embeds } : {}) };
  // Each block's marks, numbered page-wide in page order (`order` collects them for drawMarginalia).
  const marked = (block: ProjectedVisibleBlock, text: string) => {
    const list = marks.get(block.id);
    if (!list?.length || order.length >= MAX_PUBLISHED_MARKS) return text;
    const first = order.length;
    order.push(...list);
    return placeMarkSentinels(text, list, first);
  };
  // A tailnet page's block anchors (`anchors` collects their ids, for drawAnchors).
  const anchored = (block: ProjectedVisibleBlock, text: string) => {
    if (!anchors || !blockAnchors) return text;
    anchors.push(block.id);
    return placeAnchor(text, anchors.length - 1);
  };
  // Each block's own step boxes, numbered page-wide (`steps` collects them, for drawSteps); the same length as the boxes.
  const valued = (block: ProjectedVisibleBlock) => (values.has(block.id) ? valuedText(block.text ?? "", values.get(block.id)!) : block.text ?? "");
  const stepped = (block: ProjectedVisibleBlock) => steps ? placeStepSentinels(valued(block), { id: block.id, revision: block.revision ?? 0 }, steps) : valued(block);
  const decorated = (block: ProjectedVisibleBlock) => decoratedText(stepped(block), decorations.get(block.id), under.get(block.id), drawn.get(block.id),
    anchors ? lineAddresses(block.text ?? "", block.id === root.id ? "" : `${block.id}--`, anchors) : undefined);
  const rootText = marked(root, publishedText(decorated(root), context, { title: true }));
  const [first = "", ...rest] = rootText.split("\n");
  // A note with a Work ID heads its title with it (PIE-809: `HOME-011 · <title>`), once; `accentWorkId` colours it.
  const workId = getProperty(parseProperties(root.text ?? ""), "work-id");
  const headed = (title: string) => { const named = workIdTitle(title, workId); return named.workId ? `${named.workId} · ${named.title}` : title; };
  const lines = (/^#{1,6}\s/.test(first) ? [first.replace(/^(#{1,6}\s+)(.*)$/, (_, mark: string, text: string) => `${mark}${headed(text)}`), ...rest]
    // A note that opens with an embed keeps it below the heading.
    : first.startsWith(">") ? [`# ${headed(root.id)}`, "", first, ...rest]
      : [`# ${headed(first.trim() || root.id)}`, ...rest]);
  lines[0] = anchored(root, lines[0]!);
  const listed: string[] = [];
  for (const { block, locked } of rows) {
    const text = locked ? placeholder(LOCKED_NOTE) : anchored(block, marked(block, publishedText(decorated(block), context)));
    const indent = "  ".repeat(Math.max(0, block.depth - root.depth - 1));
    const [head = "", ...tail] = text.split("\n");
    listed.push(`${indent}- ${head}`);
    for (const line of tail) listed.push(line ? `${indent}  ${line}` : "");
  }
  const parts = [lines.join("\n").replace(/\n+$/, "")];
  if (listed.length) parts.push(listed.join("\n"));
  if (subtree.completeness.kind === "truncated") parts.push(`*(Only the first ${PUBLISH_QUERY_LIMIT} blocks are published.)*`);
  return `${parts.join("\n\n")}\n`;
}

/**
 * Links between published notes, in a page read as HTML: to the other note's HTML too (`?view=html`, as the
 * index links), not its raw Markdown. Only a link to exactly a published note's path changes.
 */
export function htmlViewLinks(html: string, index: PublishedIndex, basePath: string): string {
  const to = new Map(index.entries.map((entry) => [escapeHtml(`${basePath}${entry.path}`), escapeHtml(entryHref(entry, basePath))]));
  return html.replace(/<a href="([^"]*)"/g, (whole, href: string) => {
    const hash = href.indexOf("#");
    const path = hash < 0 ? href : href.slice(0, hash);
    const fragment = hash < 0 ? "" : href.slice(hash);
    const html = to.get(path);
    return html ? `<a href="${html}${fragment}"` : whole;
  });
}

function entryHref(entry: PublishedEntry, basePath: string): string {
  const view = entry.type === "markdown" || entry.type === "block" ? "?view=html" : "";
  return `${basePath}${entry.path}${view}`;
}

/** A public note's public URL, for the index and `publish list`. */
type PublicHref = (entry: PublishedEntry) => string | undefined;
const defaultPublicHref: PublicHref = (entry) => entry.public ? `${DEFAULT_PUBLIC_BASE_PATH}${entry.path}` : undefined;

export function renderIndexText(index: PublishedIndex, basePath = "", publicHref: PublicHref = defaultPublicHref): string {
  const header = ["TYPE", "UPDATED", "URL", "PUBLIC", "TITLE"];
  const rows = index.entries.map((entry) => [
    entry.type,
    entry.updatedAt.replace("T", " ").replace(/\.\d+Z$/, "Z"),
    `${basePath}${entry.path}`,
    publicHref(entry) ?? "-",
    entry.title +
      (entry.collision ? `  (collision: ${entry.collision.requested} is held by ${entry.collision.heldBy})` : "") +
      (entry.attachment?.refused ? `  (attachment not served: ${entry.attachment.refused})` : ""),
  ]);
  const widths = header.map((_, column) => Math.max(header[column]!.length, ...rows.map((row) => row[column]!.length)));
  const format = (row: string[]) => row.map((cell, column) => column === row.length - 1 ? cell : cell.padEnd(widths[column]!)).join("  ");
  const lines = [format(header), ...rows.map(format)];
  if (!rows.length) lines.push("(nothing is published; add [publish::true] to a block)");
  if (index.truncated) lines.push(`(only the first ${PUBLISH_QUERY_LIMIT} published blocks are listed)`);
  lines.push("", EMBED_NOTICE);
  return `${lines.join("\n")}\n`;
}

export function renderIndexHtml(index: PublishedIndex, basePath = "", publicHref: PublicHref = defaultPublicHref): string {
  const rows = index.entries.map((entry) => {
    const notes = [
      entry.collision ? `collision: “${escapeHtml(entry.collision.requested)}” is held by ${escapeHtml(entry.collision.heldBy)}` : "",
      entry.attachment?.refused ? `attachment not served: ${escapeHtml(entry.attachment.refused)}` : "",
    ].filter(Boolean).map((note) => `<div class="dim">${note}</div>`).join("");
    const raw = entry.type === "markdown" || entry.type === "block"
      ? ` <a class="dim" href="${escapeHtml(`${basePath}${entry.path}`)}">md</a>` : "";
    const shared = publicHref(entry);
    const open = shared ? `<div class="dim">public: <a href="${escapeHtml(shared)}">${escapeHtml(shared)}</a></div>` : "";
    return `<tr><td><a href="${escapeHtml(entryHref(entry, basePath))}">${escapeHtml(entry.title)}</a>${notes}</td>` +
      `<td>${escapeHtml(`${basePath}${entry.path}`)}${raw}${open}</td><td>${escapeHtml(entry.type)}</td>` +
      `<td>${escapeHtml(entry.updatedAt.slice(0, 16).replace("T", " "))}</td></tr>`;
  }).join("\n");
  const body = index.entries.length
    ? `<table><thead><tr><th>title</th><th>url</th><th>type</th><th>updated</th></tr></thead><tbody>\n${rows}\n</tbody></table>`
    : `<p class="dim">Nothing is published yet. Add <code>[publish::true]</code> to a block.</p>`;
  const truncated = index.truncated ? `<p class="dim">Only the first ${PUBLISH_QUERY_LIMIT} published blocks are listed.</p>` : "";
  const notice = `<p class="dim">${escapeHtml(EMBED_NOTICE)}</p>`;
  return htmlPage("Published", `${body}${truncated}\n${notice}\n<footer><a href="${escapeHtml(`${basePath}/index.txt`)}">index.txt</a> · <a href="${escapeHtml(`${basePath}/index.json`)}">index.json</a></footer>`, "published");
}

/**
 * Serves a publisher on 127.0.0.1 by default; exposure beyond the machine is a
 * proxy's job (`tailscale serve` for the tailnet, `tailscale funnel` for the
 * public audience, each on its own port). The public listener may instead bind
 * this machine's tailnet address, for a proxy on another tailnet machine
 * (Caddy for a custom domain).
 */
export function servePublisher(publisher: Publisher, port: number, audience: PublishAudience = "tailnet", hostname = "127.0.0.1"): ReturnType<typeof Bun.serve> {
  // A page's threads wait up to 20 s for a change (publish-page.ts): the idle limit leaves room for that.
  return Bun.serve({ hostname, port, idleTimeout: 30, fetch: (request, server) => publisher.handle(publisherRequest(request, server.requestIP(request)?.address), audience) });
}

/** Only the local reverse proxy supplies a visitor address; remote callers use their socket's peer. */
export function publisherRequest(request: Request, peer: string | undefined): Request {
  const proxy = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  if (peer && (!proxy || !request.headers.has("x-forwarded-for"))) request.headers.set("x-forwarded-for", peer);
  return request;
}
