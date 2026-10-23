// A note saved before the host knows its resource providers (they're read in the background after it starts
// answering) still gets its records: the sync that arrives catches up on what was saved in that window.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ExtensionSync, ExtensionSyncs } from "../src/extension-sync";
import { directiveProvidersOf } from "../src/resource-references";
import { OutlinerStore } from "../src/store";
import { JIRA_PROVIDER } from "./resource-providers";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("a ticket line saved before the providers are read is fetched once the Jira sync arrives", async () => {
  const root = mkdtempSync("/tmp/outliner-early-save-");
  roots.push(root);
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  const syncs = new ExtensionSyncs(store, { pollMs: 0 });
  syncs.start();
  const asked: string[] = [];
  const original = ExtensionSync.prototype.materialize;
  ExtensionSync.prototype.materialize = function (this: ExtensionSync, blockId: string) { asked.push(blockId); return Promise.resolve(); };
  try {
    // The host answers before its providers are known: the save's change reaches no sync.
    const page = store.create("Printer ticket [jira::ACME-14]\nOur own note: call the supplier.");
    syncs.blockChanged(page.id);
    // Then the registry is read: the store learns jira::, and the Jira sync is made.
    store.resourceProviders = directiveProvidersOf([JIRA_PROVIDER]);
    syncs.use(["jira"]);
    await Bun.sleep(20);
    expect(asked).toContain(page.id);
  } finally {
    ExtensionSync.prototype.materialize = original;
    syncs.stop();
    store.close?.();
  }
});
