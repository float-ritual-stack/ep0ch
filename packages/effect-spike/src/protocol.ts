// Slice B of the Effect 4 spike (not for merge): outline-core's wire types (src/protocol.ts there) as Schema, and the
// door's socket boundary decoding with them. Today the wire types are TypeScript interfaces: both sides import them,
// but a line that arrives is `JSON.parse`d and trusted (the door's `JsonLines`), and the door redeclares a `WireBlock`
// of its own beside outline-core's `Block`. With Schema, one definition is the type, the decoder, the encoder and the
// JSON Schema, so the "redeclared wire types" and "untyped JSON at a boundary" classes have one owner.
//
// Pure: Schema does no I/O. This file could live in outline-core as it is.
import * as Schema from "effect/Schema";
import { PROTOCOL, protocolMismatch } from "@ep0ch/outline-core/protocol";

export const BlockAuthor = Schema.Literals(["user", "agent", "system"]);
export const BlockProperty = Schema.Struct({ key: Schema.String, value: Schema.String });

/** A block as the service sends it whole. */
export const Block = Schema.Struct({
  id: Schema.String,
  parentId: Schema.NullOr(Schema.String),
  position: Schema.Int,
  text: Schema.String,
  revision: Schema.Int,
  author: BlockAuthor,
  actorId: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  taskId: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  deletedAt: Schema.optionalKey(Schema.String),
  effectiveDeletedRootId: Schema.optionalKey(Schema.String),
  // `Schema.Array`'s Type is `readonly T[]`; outline-core's interfaces are mutable, so the array is marked mutable to stay assignable.
  properties: Schema.mutable(Schema.Array(BlockProperty)),
});
export type Block = typeof Block.Type;

/** A query the service refused, with where. */
export const OutlinerRequestProblem = Schema.Struct({
  code: Schema.Literals(["query-syntax", "query-invalid"]),
  message: Schema.String,
  field: Schema.optionalKey(Schema.String),
  position: Schema.optionalKey(Schema.Int),
});

/** One answer line on the socket. `result` stays unknown here: each action decodes its own. */
export const OutlinerResponse = Schema.Union([
  Schema.Struct({ id: Schema.String, ok: Schema.Literal(true), result: Schema.Unknown, sequence: Schema.Int }),
  Schema.Struct({ id: Schema.String, ok: Schema.Literal(false), error: Schema.String, problem: Schema.optionalKey(OutlinerRequestProblem), sequence: Schema.Int }),
]);
export type OutlinerResponse = typeof OutlinerResponse.Type;

/** One line of the socket, text to a response: `JSON.parse` and the shape check in one decoder. */
export const ResponseLine = Schema.fromJsonString(OutlinerResponse);

/**
 * The service's PROTOCOL as `ping` reports it: any other number is refused *while decoding*, with outline-core's own
 * sentence (which names both numbers and the side to update). The check is on the wire type, so no caller can read a
 * status and forget to compare.
 */
export const ProtocolVersion = Schema.Int.check(Schema.makeFilter(n => protocolMismatch(n, "this client") ?? true));

/** What `ping` answers. */
export const OutlinerServiceStatus = Schema.Struct({
  status: Schema.Literal("ready"),
  protocolVersion: ProtocolVersion,
  outlineInstanceId: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(Schema.Struct({ hostname: Schema.String, workspaceRoot: Schema.String, database: Schema.String, stateDirectory: Schema.String })),
  outline: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  host: Schema.optionalKey(Schema.Struct({ socket: Schema.String, defaultOutline: Schema.optionalKey(Schema.String), outlines: Schema.mutable(Schema.Array(Schema.String)) })),
});
export type OutlinerServiceStatus = typeof OutlinerServiceStatus.Type;

export { PROTOCOL };

/** Decoders a client calls at its boundary; each throws a `SchemaError` whose message names the path and the issue. */
export const decodeResponseLine = Schema.decodeUnknownSync(ResponseLine);
export const decodeBlock = Schema.decodeUnknownSync(Block);
export const decodeStatus = Schema.decodeUnknownSync(OutlinerServiceStatus);
export const decodeStatusAll = Schema.decodeUnknownSync(OutlinerServiceStatus, { errors: "all" });
export const decodeStatusResult = Schema.decodeUnknownResult(OutlinerServiceStatus);
export const encodeBlock = Schema.encodeSync(Block);

/** The JSON Schema of a block (draft 2020-12), for the Claude mod's and MCP's tool definitions. */
export const blockJsonSchema = () => Schema.toJsonSchemaDocument(Block);
