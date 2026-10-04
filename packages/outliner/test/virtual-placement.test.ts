import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OutlinerClient} from "../src/client";
import {OutlinerServer} from "../src/server";
import {OutlinerStore} from "../src/store";
import type {VirtualBranchOrder, VirtualBranchPlacement, WorkspaceSnapshot} from "../src/types";

const cleanups: (() => Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0)) await cleanup();});

async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),"outliner-placement-"));
  const store=new OutlinerStore(join(dir,"outline.sqlite"));
  const server=new OutlinerServer(store,join(dir,"outline.sock"));
  await server.start();
  cleanups.push(async()=>{await server.close();store.close();rmSync(dir,{recursive:true,force:true});});
  const client=new OutlinerClient(join(dir,"outline.sock"));
  const view=store.create("Candidates [type::virtual-branch] [query::lane=todo] [limit::3]");
  const other=store.create("Other view [type::virtual-branch] [query::lane=todo]");
  const blocks=Array.from("ABCDEFGH",letter=>store.create(letter+" [lane::todo]"));
  const ids=blocks.map(b=>b.id);
  store.reorderVirtualOccurrences(view.id,ids);
  store.reorderVirtualOccurrences(other.id,[...ids].reverse());
  const order=()=>client.request<VirtualBranchOrder>({action:"virtual.occurrences.order",viewId:view.id});
  const place=(expected:VirtualBranchOrder,selectedBlockIds:string[],placement:VirtualBranchPlacement)=>
    client.request<VirtualBranchOrder>({action:"virtual.occurrences.place",input:{expected,selectedBlockIds,placement}});
  return {store,client,view,other,blocks,ids,order,place};
}

test("bulk placement preserves selected runs, hidden roots and other branch ranks",async()=>{
  const f=await fixture();
  const canonical=f.blocks.map(b=>f.store.get(b.id));
  const snapshot=await f.client.request<WorkspaceSnapshot>({action:"workspace.snapshot"});
  const otherRanks=snapshot.virtualOccurrenceRanks.filter(r=>r.viewId===f.other.id);
  const cases: [VirtualBranchPlacement,string][]=[
    [{kind:"up"},"BADECFGH"], [{kind:"down"},"ACBFDEGH"],
    [{kind:"top"},"BDEACFGH"], [{kind:"bottom"},"ACFGHBDE"],
    [{kind:"before",anchorId:f.ids[6]!},"ACFBDEGH"],
    [{kind:"after",anchorId:f.ids[6]!},"ACFGBDEH"],
  ];
  for(const [placement,letters] of cases){
    f.store.reorderVirtualOccurrences(f.view.id,f.ids);
    const expected=await f.order();
    expect(expected.blockIds).toEqual(f.ids); // The display limit is three; rank scope is all eight.
    expect(expected.completeness.kind).toBe("complete");
    const result=await f.place(expected,[f.ids[4]!,f.ids[1]!,f.ids[3]!],placement);
    expect(result.blockIds).toEqual([...letters].map(letter=>f.ids[letter.charCodeAt(0)-65]!));
    expect(await f.order()).toEqual(result);
  }
  expect(f.blocks.map(b=>f.store.get(b.id))).toEqual(canonical);
  const after=await f.client.request<WorkspaceSnapshot>({action:"workspace.snapshot"});
  expect(after.virtualOccurrenceRanks.filter(r=>r.viewId===f.other.id)).toEqual(otherRanks);
  const expected=await f.order();
  const sequence=f.store.sequence;
  expect(await f.place(expected,[expected.blockIds[0]!],{kind:"up"})).toEqual(expected);
  expect(f.store.sequence).toBe(sequence);
});

test("placement rejects stale order, changed membership and ambiguous selections atomically",async()=>{
  const f=await fixture();
  let expected=await f.order();
  const rejects=async(snapshot:VirtualBranchOrder,selected:string[],placement:VirtualBranchPlacement,reason:RegExp)=>{
    const sequence=f.store.sequence;
    const before=await f.order();
    await expect(f.place(snapshot,selected,placement)).rejects.toThrow(reason);
    expect(await f.order()).toEqual(before);
    expect(f.store.sequence).toBe(sequence);
  };
  await rejects(expected,[],{kind:"top"},/select/i);
  await rejects(expected,[f.ids[0]!,f.ids[0]!],{kind:"top"},/duplicate/i);
  await rejects(expected,[f.other.id],{kind:"top"},/member/i);
  await rejects(expected,[f.ids[0]!],{kind:"before",anchorId:f.ids[0]!},/anchor/i);
  await rejects(expected,[f.ids[0]!],{kind:"after",anchorId:"missing"},/anchor/i);
  f.store.reorderVirtualOccurrences(f.view.id,[...f.ids].reverse());
  await rejects(expected,[f.ids[0]!],{kind:"top"},/changed/i);
  expected=await f.order();
  f.store.create("New member [lane::todo]");
  await rejects(expected,[f.ids[0]!],{kind:"top"},/changed/i);
  expected=await f.order();
  const view=f.store.get(f.view.id)!;
  f.store.update(view.id,view.text+"\nChanged definition",view.revision,{author:"user"});
  await rejects(expected,[f.ids[0]!],{kind:"top"},/changed/i);
  expected=await f.order();
  f.store.delete(f.ids[0]!);
  await rejects(expected,[f.ids[0]!],{kind:"top"},/changed/i);
  const current=f.store.get(f.view.id)!;
  f.store.update(current.id,current.text.replace("[limit::3]","[limit::3] [sort::updated]"),current.revision,{author:"user"});
  await expect(f.order()).rejects.toThrow(/sorts by updated desc, so it has no hand-set order: remove \[sort::updated\]/);
});

test("truncated membership cannot authorize a bulk placement",async()=>{
  const f=await fixture();
  for(let i=0;i<993;i++) f.store.create(`Candidate ${i} [lane::todo]`);
  const expected=await f.order();
  expect(expected.completeness.kind).toBe("truncated");
  const sequence=f.store.sequence;
  await expect(f.place(expected,[f.ids[0]!],{kind:"top"})).rejects.toThrow(/complete|truncated/i);
  expect(f.store.sequence).toBe(sequence);
});

test("placement checks the saved selection in the same transaction as ranking",async()=>{
  const f=await fixture();
  const saved=await f.client.request<import('../src/types').WorkingSelection>({action:'working-selection.save',input:{ownerClientId:'ranking-tree',expected:null,targets:[{blockId:f.ids[4]!,rowId:'appearance-e'}]}});
  const expected=await f.order();
  await f.client.request({action:'working-selection.save',input:{ownerClientId:'ranking-tree',expected:saved,targets:[]}});
  await expect(f.client.request({action:'virtual.occurrences.place',input:{expected,selectedBlockIds:[f.ids[4]!],placement:{kind:'top'},selection:saved}})).rejects.toThrow(/selection changed/i);
  expect((await f.order()).blockIds).toEqual(f.ids);
});
