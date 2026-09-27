import assert from "node:assert/strict";
import {readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join, resolve, sep} from "node:path";
import {visibleWidth} from "@earendil-works/pi-tui";
import type {Block, InternResourceReceipt, OutlinerNavigationTarget, ResourceDescription} from "../../src/types";
import {forwardService} from "./service-forwarder";
import {runHerdrScenario} from "./herdr-runner";

const result = await runHerdrScenario({
  name: "selection-navigation",
  async prepare(root) {await writeFile(join(root,"selection.md"),"# Selection Resource\n\nRESOURCE COPY PASSAGE\n");},
  async run(session) {
    const terminal = await session.attachClient();
    await terminal.resize(190, 55);
    const {detail} = session.panes;
    const reader = (await session.registrations()).find(c => c.role === "detail" && c.runtime?.paneId === detail)!;
    assert.ok(reader);
    const a = await session.client.request<Block>({action:"create",text:"Selection origin\n\nCOPY THIS PASSAGE from the original document."});
    const b = await session.client.request<Block>({action:"create",text:"Selection destination\n\nDESTINATION CONTENT"});
    const target = (block:Block):OutlinerNavigationTarget => ({kind:"block",blockId:block.id});
    const current = async () => (await session.registrations()).find(c=>c.clientId===reader.clientId)!;
    const replace = (target:OutlinerNavigationTarget) => session.client.request({action:"ui.command.send",command:{targetClientId:reader.clientId,targetRegion:"detail",command:"replace",target}});
    const copy = async (label:string, anchorLabel="Current ·") => {
      await session.focus(detail);
      const point = (text:string) => {
        const rows=text.split("\n");
        const row=rows.findIndex(line=>line.includes(label));
        const anchor=rows.findIndex(line=>line.includes(anchorLabel));
        if(row<0||anchor<0)return null;
        const column=visibleWidth(rows[row]!.slice(0,rows[row]!.indexOf(label)));
        const left=visibleWidth(rows[anchor]!.slice(0,rows[anchor]!.indexOf(anchorLabel)));
        return {row,column,line:rows[anchor]!.trimEnd(),relativeRow:row-anchor,relativeColumn:column-left};
      };
      // Native screen and application pane must agree after the resize has reached both.
      const ready=await session.waitFor("attached selection aligned",async()=>({native:point(await terminal.visible()),pane:point(await session.visible(detail))}),({native,pane})=>!!native&&!!pane&&native.line.includes(pane.line)&&native.relativeRow===pane.relativeRow&&native.relativeColumn===pane.relativeColumn);
      const before=(await readFile(join(session.artifactDirectory,"attached-client.ansi"),"utf8")).length;
      const {row,column}=ready.native!;
      await terminal.write(`\x1b[<0;${column+1};${row+1}M\x1b[<32;${column+label.length};${row+1}M\x1b[<0;${column+label.length};${row+1}m`);
      await session.waitFor("copy emitted",()=>readFile(join(session.artifactDirectory,"attached-client.ansi"),"utf8"),text=>[...text.slice(before).matchAll(/\x1b\]52;[^;]*;([A-Za-z0-9+/=]+)/g)].some(m=>Buffer.from(m[1]!,"base64").toString()===label));
    };
    for (const columns of [190,150]) {
      await terminal.resize(columns,55);
      await replace(target(a));
      await session.waitVisible(detail,"COPY THIS PASSAGE");
      await copy("COPY THIS PASSAGE");
      await session.checkpoint(`selected-${columns}`);
      // First request must work without Escape or another clearing click.
      await replace(target(b));
      await session.waitVisible(detail,"DESTINATION CONTENT");
      assert.ok(!(await current()).navigationProtection);
      assert.deepEqual((await current()).currentTarget,target(b));
      await session.checkpoint(`navigated-${columns}`);
    }

    const {resource}=await session.client.request<InternResourceReceipt>({action:"resources.intern-filesystem",input:{path:"selection.md"}});
    const description=await session.client.request<ResourceDescription>({action:"resources.describe",destinationClientId:reader.clientId,target:{kind:"resource",resourceId:resource.id}});
    const resourceTarget:OutlinerNavigationTarget={kind:"resource",resourceId:resource.id,revision:description.filesystem!.revision};
    await replace(resourceTarget);
    await session.waitVisible(detail,"RESOURCE COPY PASSAGE");
    await copy("RESOURCE COPY PASSAGE");
    await replace(target(b));
    await session.waitVisible(detail,"DESTINATION CONTENT");
    await session.checkpoint("resource-copy-first-navigation");

    await terminal.resize(340,64);
    await session.client.request({action:"ui.command.send",command:{targetClientId:reader.clientId,command:"preview",target:target(a)}});
    await session.waitVisible(detail,"COPY THIS PASSAGE");
    await copy("COPY THIS PASSAGE","Preview · Selection origin");
    await replace(resourceTarget);
    await session.waitFor("Current replaced after Preview copy",current,c=>c.currentTarget?.kind==="resource");
    assert.ok(!(await current()).navigationProtection);
    await session.checkpoint("preview-copy-does-not-protect-current");
    await session.keys(detail,"f7","escape");

    // Hold the real Herdr snapshot reply, not a synthetic selection or controller flag.
    const {status}=JSON.parse(await readFile(join(session.artifactDirectory,"herdr-readiness.json"),"utf8"));
    const socket=String(status.socket);
    assert.ok(resolve(socket).startsWith(resolve(dirname(session.projectRoot))+sep));
    const upstream=socket+".selection-upstream";
    await rename(socket,upstream);
    const proxy=await forwardService(socket,upstream).catch(async error=>{await rename(upstream,socket);throw error;});
    try {
      await replace(target(a));
      await session.waitVisible(detail,"COPY THIS PASSAGE");
      const held=proxy.holdNext({method:"pane.read",contains:'"lines":10000'});
      await copy("COPY THIS PASSAGE");
      await session.waitFor("capture reply held",()=>held.state,v=>v==="held");
      await replace(target(b));
      await session.waitVisible(detail,"DESTINATION CONTENT");
      held.release();
      const delivered=await session.waitFor("snapshot delivered",()=>proxy.measurements(),v=>v.some(r=>r.held));
      assert.ok(delivered.find(r=>r.held)!.elapsedMs<1900,"Reply must arrive before the capture timeout, not be discarded by timeout");
      await session.record("delayed-capture",delivered.filter(r=>r.held));
      await replace(target(a));
      await session.waitVisible(detail,"COPY THIS PASSAGE");
      await session.keys(detail,"c");
      await session.waitVisible(detail,"Drag across text before commenting");
      await copy("COPY THIS PASSAGE");
      await session.keys(detail,"c");
      await session.waitVisible(detail,"Ctrl+S save");
      await session.text(detail,"Fresh selected-passage comment");
      await session.waitFor("comment protected",current,c=>!!c.navigationProtection);
      await assert.rejects(replace(target(b)),/protected/);
      await session.waitVisible(detail,"Fresh selected-passage comment");
      await session.keys(detail,"escape");
      await session.waitFor("cancel releases draft protection",current,c=>!c.navigationProtection);
      await session.checkpoint("late-capture-retired-comment-protected");
    } finally {
      await proxy.close();
      await rename(upstream,socket);
    }
    assert.equal((await session.client.request<Block>({action:"get",blockId:a.id})).revision,a.revision);
    await session.record("coverage",{input:"Attached-terminal pointer drag and Herdr keys",clipboard:"Exact emitted OSC52 payload observed; physical OS clipboard paste not claimed",resource:resource.id,ordinarySelectionProtects:false});
  },
});
console.log(JSON.stringify(result));
if(result.status!=="passed")process.exitCode=1;
