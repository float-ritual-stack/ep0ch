import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OutlinerClient, type OutlinerWatcher } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { navigateOutlinerLink, outlinerLinkUri, resourceOccurrenceLink } from "../src/outliner-links";
import { clientSupportsRole, type NavigationLinkState, type OutlinerClientRegistration, type OutlinerEvent, type OutlinerNavigationDispatch } from "../src/types";

test("observers receive content events but cannot enter navigation destinations", async () => {
  const root = mkdtempSync("/tmp/outliner-observer-");
  const store = new OutlinerStore(join(root, "db.sqlite"));
  const server = new OutlinerServer(store, join(root, "app.sock"));
  const watchers: OutlinerWatcher[] = [];
  try {
    await server.start();
    const client = new OutlinerClient(server.socketPath);
    const observed = Promise.withResolvers<OutlinerEvent>();
    for (const registration of [
      {clientId:"tree",role:"tree",contextId:"paired"},
      {clientId:"detail",role:"detail",contextId:"paired"},
      {clientId:"observer",role:"observer",contextId:"paired"},
    ] satisfies OutlinerClientRegistration[]) {
      const connected = Promise.withResolvers<void>();
      watchers.push(client.watch({client:registration,onConnect:connected.resolve,onError:connected.reject,
        onEvent:event => { if (registration.role === "observer" && event.domain === "content") observed.resolve(event); }}));
      await connected.promise;
    }
    await client.request({action:"create",text:"Observed content"});
    expect((await observed.promise).domain).toBe("content");
    const source = {clientId:"tree",region:"tree" as const};
    const links = await client.request<NavigationLinkState>({action:"navigation.link.get",source});
    expect(links.destinations.map(item => item.view.clientId)).toEqual(["detail"]);
    expect((await client.request<OutlinerClientRegistration[]>({action:"clients.list",role:"observer"})).map(item => item.clientId)).toEqual(["observer"]);
    expect(clientSupportsRole({role:"composed"},"observer")).toBe(false);
    await expect(client.request({action:"navigation.link.set",source,destination:{clientId:"observer",region:"detail"}})).rejects.toThrow("live Detail");
    const target = {kind:"block" as const,blockId:store.create("Target").id};
    await expect(client.request({action:"navigation.dispatch",sourceClientId:"tree",target,intent:"open",destination:{clientId:"observer",region:"detail"}})).rejects.toThrow("destination closed");
    for (const command of ["open","replace","edit","preview","focus"] as const) {
      await expect(client.request({action:"ui.command.send",command:{command,targetClientId:"observer",target}})).rejects.toThrow("Observers are not navigation destinations");
    }
  } finally {
    for (const watcher of watchers) await watcher.stop();
    await server.close();store.close();rmSync(root,{recursive:true,force:true});
  }
});

test("direct Resource opens require an explicit available destination and preserve protected work", async () => {
  const root = mkdtempSync("/tmp/outliner-resource-route-");
  const store = new OutlinerStore(join(root,"db.sqlite"),{workspaceRoot:root});
  const server = new OutlinerServer(store,join(root,"app.sock"));
  let watcher: OutlinerWatcher | undefined;
  try {
    await server.start();
    const client = new OutlinerClient(server.socketPath);
    const connected = Promise.withResolvers<void>();
    watcher = client.watch({client:{clientId:"detail",role:"detail",contextId:"reader"},onConnect:connected.resolve,onError:connected.reject,onEvent() {}});
    await connected.promise;
    writeFileSync(join(root,"note.md"),"Pinned Resource bytes");
    const source = store.create("Source [file::note.md]");
    const occurrence = resourceOccurrenceLink(source,{start:7,end:source.text.length});
    const uri = outlinerLinkUri(occurrence.kind, occurrence.value, occurrence);
    const count = () => (store.database.query("SELECT count(*) AS count FROM resources").get() as {count:number}).count;
    const before = count();
    await expect(navigateOutlinerLink(client,uri)).rejects.toThrow("explicit Detail destination");
    await expect(navigateOutlinerLink(client,uri,{detailClientId:"missing"})).rejects.toThrow("not a live");
    expect(count()).toBe(before);
    await client.request({action:"clients.update",clientId:"detail",navigationProtection:"active annotation selection"});
    await expect(navigateOutlinerLink(client,uri,{detailClientId:"detail"})).rejects.toThrow("active annotation selection");
    expect(count()).toBe(before);
    await client.request({action:"clients.update",clientId:"detail",navigationProtection:null});
    const opened = await navigateOutlinerLink(client,uri,{detailClientId:"detail"});
    expect(opened.targetClientId).toBe("detail");
    const description = store.resources.describe(opened.id,true);
    const target = {kind:"resource" as const,resourceId:opened.id,revision:description.filesystem!.revision};
    await client.request({action:"clients.update",clientId:"detail",navigationProtection:"active draft"});
    for (const command of ["open","replace","focus"] as const) {
      await expect(client.request({action:"ui.command.send",command:{command,targetClientId:"detail",target}})).rejects.toThrow("active draft");
    }
    await client.request({action:"clients.update",clientId:"detail",navigationProtection:null});
    const dispatched = await client.request<OutlinerNavigationDispatch>({action:"navigation.dispatch",sourceClientId:"detail",destination:{clientId:"detail",region:"detail"},intent:"open",target});
    expect(dispatched.command).toMatchObject({target});
  } finally {
    await watcher?.stop();await server.close();store.close();rmSync(root,{recursive:true,force:true});
  }
});
