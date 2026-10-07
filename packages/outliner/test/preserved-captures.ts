import {captureHistoryResource} from '../src/capture-history';
import type {OutlinerStore} from '../src/store';
import type {Block} from '../src/types';

/**
 * Seeds a preserved capture as the removed Inbox agent left one (PIE-613): an applied result whose
 * recovery_json holds the before-images of the notes it rewrote. Nothing in the service writes these now.
 */
export function preserveCapture(store:OutlinerStore,attemptId:string,before:Block[],recovery:'kept'|'missing'='kept'):void {
  const source=before[0]!;
  store.database.query('INSERT INTO inbox_agent_results (id,source_id,payload_hash,result_json,recovery_json,created_at) VALUES (?,?,?,?,?,?)')
    .run(attemptId,source.id,'fixture',JSON.stringify({id:attemptId,sourceId:source.id,state:'applied',outputIds:[]}),
      recovery==='kept'?JSON.stringify({before,createdIds:[]}):null,new Date().toISOString());
}

/** Rewrites `block` to `text` linked to its preserved original, as a cleaned note carries it; returns the Resource id. */
export function rewriteWithOriginal(store:OutlinerStore,block:Block,attemptId:string,text:string,key:'raw-capture'|'before-rewrite'='raw-capture'):{block:Block;resourceId:string} {
  const resourceId=captureHistoryResource(store.database,store.resources,attemptId,block.id);
  const [title,...rest]=text.split('\n');
  return {block:store.update(block.id,[`${title} [${key}::${resourceId}]`,...rest].join('\n'),block.revision),resourceId};
}
