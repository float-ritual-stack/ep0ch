import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { Block } from "./types";

/** The receipt and the block commit together; a retry reads the block even if someone has edited it since. */
export function createRequestedBlock(
  database: Database, requestId: string | undefined, payload: unknown,
  create: () => Block, read: (id: string) => Block,
): Block & { deduplicated?: true } {
  if (requestId === undefined) return create();
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return database.transaction(() => {
    const receipt = database.query("SELECT payload_hash, block_id FROM create_requests WHERE request_id = ?")
      .get(requestId) as { payload_hash: string; block_id: string } | null;
    if (receipt) {
      if (receipt.payload_hash !== hash) throw new Error(`Create request ID was already used with different input: ${requestId}`);
      return { ...read(receipt.block_id), deduplicated: true as const };
    }
    const block = create();
    database.query("INSERT INTO create_requests (request_id, payload_hash, block_id, created_at) VALUES (?, ?, ?, ?)")
      .run(requestId, hash, block.id, block.createdAt);
    return block;
  })();
}
