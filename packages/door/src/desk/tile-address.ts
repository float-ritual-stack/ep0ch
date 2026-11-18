// The one grammar `tile=` reads for a tile that is not on the screen you are asking from (PIE-1286): `t-<uuid>` (this
// exact tile), `role:<role>[@scope]`, `<slot>@<screen>`, `^` and, last, a name. The grammar and the resolver are
// outline-core's (screen-spec.ts), shared by every client that takes `tile=`; the desk lists the tiles it has
// (AddressCandidate) and asks which one an address means.
export { AGENT_ALIAS, matches, MIN_ID_PREFIX, parseTileAddress, resolveAddress, resolveRelative, ROLE_AGENT, shortTileId, whyNone, type AddressCandidate, type ResolveOpts, type TileAddress } from "@ep0ch/outline-core/screen-spec";
