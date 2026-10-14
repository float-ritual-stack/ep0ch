import type {Database} from "bun:sqlite";
import {Type} from "typebox";
import {defineComputedProducer} from "./computed-resources";
import type {Block} from "./types";

export const CAPTURE_HISTORY_PRODUCER="builtin.capture-history";
const inputSchema=Type.Object({attemptId:Type.String({minLength:1,maxLength:200}),blockId:Type.String({minLength:1,maxLength:100})},{additionalProperties:false});

/** Read the preserved bytes by receipt and owner, never by matching current text. */
export function readCaptureBefore(database:Database,attemptId:string,blockId:string):Block|undefined {
  const row=database.query("SELECT recovery_json FROM inbox_agent_results WHERE id=?").get(attemptId) as {recovery_json:string|null}|null;
  return row?.recovery_json ? (JSON.parse(row.recovery_json) as {before:Block[]}).before.find(block=>block.id===blockId) : undefined;
}

/** Resolve the immutable before-images the removed Inbox agent preserved (PIE-613: read only, nothing
 * writes them now). No new authored note, execution request, or independent copy of the original. */
export function captureHistoryProducer(database:Database){
  return defineComputedProducer({id:CAPTURE_HISTORY_PRODUCER,version:1,inputSchema,
    permissions:["inbox.history.read"],determinism:"deterministic",cachePolicy:"content-addressed",outputMediaTypes:["text/markdown"],
    async execute({inputs}){
      if(inputs.attemptId.startsWith("lineage-unavailable:"))return {kind:"failure" as const,code:"lineage-limit",message:"Original capture lineage exceeded its historical inspection budget; the original is not fully identified. Current text is not a substitute."};
      const before=readCaptureBefore(database,inputs.attemptId,inputs.blockId);
      if(!before)return {kind:"failure" as const,code:"capture-unavailable",message:"No preserved capture exists for this attempt. Current text is not a substitute."};
      return {kind:"immutable-snapshot" as const,mediaType:"text/markdown",content:before.text};
    },
  });
}
