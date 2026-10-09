// Who made a write (PIE-679): a principal that auth proved, and a persona it declared on top. The service records one
// actor id per change, so both ride in it:
//
//   <persona>/<principal>   loki/claude-code@float-2     a persona, within the principal it was claimed under
//   <principal>             claude-code@float-2, claude.ai   no persona
//
// and an MCP write's id carries the `mcp:` prefix in front. A principal is `<client>` (the HTTP gateway: the OAuth
// client auth proved) or `<client>@<machine>` (stdio and the Claude mod: the client on that machine). A persona is only
// a label and never leaves its principal: nothing here maps one principal's persona to another. Older ids (`mcp:daddy`,
// `claude-code`, `evan`) parse as they are, with the name shown as it was.
//
// A write also has a `sessionId` (the service stores it beside the actor id), and it holds two things, neither
// overwriting the other (PIE-685):
//
//   <subject>              stdio, 4f2a-oauth-subject    who the connection was (the OAuth subject; `stdio`): as before
//   <subject>#<call>       stdio#c-7f3a1c               and the call that made the write
//
// A call is one MCP caller's visit to the board, in the BBS word: the HTTP transport's `Mcp-Session-Id` (the gateway
// mints it at `initialize` as `c-` and six hex digits), one per stdio connection, or a name the agent supplies on a
// call (`call`, "daddy-2026-10-09-0103-k7f"), which wins. It is trace only: it names a conversation for `call:` queries
// and for leaving a call's own writes out of its own recent-activity reads, and a readable handle for it
// (`leaping_otter_convergence`, call-handles.ts) is minted once and stored by the MCP server. It is never identity: the
// principal and persona stay in the actor id, and display stays "daddy (claude.ai)". A sessionId with no `#<call>` (an
// older write, a person's, a CLI's) has no call.
// Pure: no I/O.

const NAME = "[A-Za-z0-9][A-Za-z0-9._-]";
export const PERSONA_PATTERN = new RegExp(`^${NAME}{0,63}$`);
export const PRINCIPAL_PATTERN = new RegExp(`^${NAME}{0,63}(@${NAME}{0,31})?$`);

export interface Attribution {
  /** The declared persona, when there is one. */
  persona?: string;
  /** The principal auth proved, when the id carries one. */
  principal?: string;
  /** The short name filters and mentions use: the persona, else the principal's client (`mcp:daddy` is `daddy`). */
  handle: string;
  /** What is shown: `loki (claude-code@float-2)`, `claude.ai`, or the id as it was. */
  label: string;
  /** Written through an MCP server. */
  mcp: boolean;
}

/** An actor id from its parts. A persona equal to the principal's own client name is no persona. */
export function composeActor(o: { persona?: string; principal: string; mcp?: boolean }): string {
  const persona = o.persona && PERSONA_PATTERN.test(o.persona) && o.persona !== o.principal.split("@")[0] ? o.persona : undefined;
  return `${o.mcp ? "mcp:" : ""}${persona ? `${persona}/` : ""}${o.principal}`;
}

export function parseActor(actorId: string | undefined | null): Attribution {
  const id = (actorId ?? "").trim();
  const mcp = id.startsWith("mcp:");
  const rest = mcp ? id.slice(4) : id;
  const slash = rest.indexOf("/");
  if (slash > 0) {
    const persona = rest.slice(0, slash), principal = rest.slice(slash + 1);
    if (PERSONA_PATTERN.test(persona) && PRINCIPAL_PATTERN.test(principal)) return { persona, principal, handle: persona, label: `${persona} (${principal})`, mcp };
  }
  if (PRINCIPAL_PATTERN.test(rest) && (mcp || rest.includes("@"))) return { principal: rest, handle: rest.split("@")[0]!, label: rest, mcp };
  return { handle: rest, label: rest, mcp };
}

/** How an actor id is shown: `loki (claude-code@float-2)`. */
export const actorLabel = (actorId: string | undefined | null): string => parseActor(actorId).label;

/** The name a filter or mention compares: `loki` for `mcp:loki/claude-code@float-2`, `daddy` for the old `mcp:daddy`. */
export const actorHandle = (actorId: string | undefined | null): string => parseActor(actorId).handle.toLowerCase();

/** The `created-by` value a scratch outline's root note carries: `loki/claude-code@float-2`, or the principal alone. */
export const createdByOf = (o: { persona?: string; principal: string }): string => composeActor(o);

export const CALL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const isCallId = (v: unknown): v is string => typeof v === "string" && CALL_PATTERN.test(v);

/** A fresh call id: `c-` and six hex digits. */
export const mintCallId = (random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(3))): string =>
  `c-${[...random()].map(b => b.toString(16).padStart(2, "0")).join("")}`;

/** A `sessionId` from its parts: the subject, and `#<call>` when the write came from a known call. */
export const composeSessionId = (o: { subject: string; call?: string | undefined }): string =>
  o.call && isCallId(o.call) ? `${o.subject}#${o.call}` : o.subject;

/** A `sessionId` read back: the subject it was composed from, and its call when it has one. */
export function parseSessionId(sessionId: string | undefined | null): { subject: string; call?: string } {
  const id = (sessionId ?? "").trim();
  const at = id.lastIndexOf("#");
  if (at >= 0 && isCallId(id.slice(at + 1))) return { subject: id.slice(0, at), call: id.slice(at + 1) };
  return { subject: id };
}

/** The call a `sessionId` carries, or undefined. */
export const callOf = (sessionId: string | undefined | null): string | undefined => parseSessionId(sessionId).call;
