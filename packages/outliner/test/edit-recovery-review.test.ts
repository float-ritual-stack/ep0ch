import {initTheme} from "@earendil-works/pi-coding-agent";
initTheme();
import {expect,test} from "bun:test";
import {EditRecoveryReview,type RecoveryChoice} from "../src/edit-recovery-review";
import type {EditRecovery} from "../src/edit-recovery";
const record:EditRecovery={id:"draft",blockId:"note",revision:1,baseText:"Base",baseRevision:1,prelaunchText:"Before editor",draftText:"Local",originalDraft:"Local",source:"external-editor",latest:{id:"note",revision:2,text:"Latest",properties:[],parentId:null,position:0,author:"user",createdAt:"",updatedAt:""},merge:{text:"Local",conflicts:[],incomplete:false},proposal:{text:"Both",basedOnRevision:2,source:"mechanical",unresolved:[],explanation:"Independent changes"},state:"retained",createdAt:"",updatedAt:""};
test("mouse actions and keyboard choices share review state; Escape retains without saving",async()=>{
  let result:RecoveryChoice|undefined;
  const view=new EditRecoveryReview([record],{refresh:async r=>r,discard:async r=>({...r,state:"discarded"})},()=>{},choice=>result=choice);
  view.key("3",{name:"3"});expect(view.render(80,20).join("\n")).toContain("Latest");
  await view.action("version.draft");expect(view.render(80,20).join("\n")).toContain("Local");
  view.key("",{name:"escape"});expect(result?.action).toBe("later");expect(result?.record.originalDraft).toBe("Local");
});
test("dismissed work cannot replace review state when its late result arrives",async()=>{
  for (const dismiss of [false, true]) {
    const pending=Promise.withResolvers<EditRecovery>();
    const choices: RecoveryChoice[] = [];
    const view=new EditRecoveryReview([record],{refresh:()=>pending.promise,discard:async r=>r},()=>{},choice=>choices.push(choice));
    const work=view.action("refresh");
    if (dismiss) {view.dismiss(); view.dismiss();} else view.key("",{name:"escape"});
    expect(choices).toEqual([{action:"later",record}]);
    pending.resolve({...record,proposal:{...record.proposal!,text:"Obsolete"}});await work;
    expect(view.record.proposal?.text).toBe("Both");
    expect(choices.length).toBe(1);
  }
});
test("first discard is inert; Escape retains the draft",async()=>{
  let discarded=0;let choice:RecoveryChoice|undefined;
  const view=new EditRecoveryReview([record],{refresh:async r=>r,discard:async r=>{discarded++;return {...r,state:"discarded"};}},()=>{},c=>choice=c);
  await view.action("discard");expect(discarded).toBe(0);view.key("",{name:"escape"});expect(choice?.action).toBe("later");
});

test("saved history offers restore and undo as new reviews with no immediate save",async()=>{
  const applied={...record,state:"applied" as const,appliedBlockId:record.blockId};
  let restored="",finished=false;
  const view=new EditRecoveryReview([applied],{refresh:async r=>r,discard:async r=>r,restore:async(_r,version)=>{restored=version;return {...record,id:"new-review"};}},()=>{},()=>{finished=true;});
  expect(view.render(100,24).join("\n")).toContain("Undo save");
  await view.action("proposal");expect(finished).toBe(false);
  await view.action("undo");expect(restored).toBe("before-save");expect(view.record.id).toBe("new-review");expect(finished).toBe(false);
  expect(view.render(100,24).join("\n")).toContain("Current note unchanged");
});
