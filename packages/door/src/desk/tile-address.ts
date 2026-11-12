// The one grammar `tile=` reads for a tile that is not on the screen you are asking from (PIE-1286). Four kinds of
// address, matched in this order, and nothing else decides which tile a request means:
//
//   t-<uuid>            this exact tile: a unique prefix of 8+ characters after `t-` works, as a block id's does
//   role:<role>[@scope] a tile of this kind, wherever it is: `role:agent` an agent tab (of several, the one the person
//                       used last), `role:reader` a reader. The role lives on the tile (set when it is made, saved with
//                       its id), so a restart, a handover or a restore keeps it. `@scope` narrows it to the drawer or to
//                       one screen
//   <slot>@<screen>     the place, whatever fills it now: a slot the screen declares (its spec's tile names, where
//                       opens land: `detail`, a docked tile) on that screen
//   ^, ^^               relative: the tile that opened this one (the acting tile's), or the one before it in the chain
//   <name>              the label a person typed. Matched last, and never the identity of anything
//
// `drawer.agent` stays as the alias of `role:agent`. Pure: the desk lists the tiles it has (AddressCandidate), this
// module says which one an address means, or why none does and what to run.
// The grammar and the resolver are outline-core's (screen-spec.ts), shared by every client that takes `tile=`.
export { AGENT_ALIAS, matches, MIN_ID_PREFIX, parseTileAddress, resolveAddress, resolveRelative, ROLE_AGENT, shortTileId, whyNone, type AddressCandidate, type ResolveOpts, type TileAddress } from "@ep0ch/outline-core/screen-spec";
