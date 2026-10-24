// Which extensions supply scripts is the extension registry's answer (PIE-1240): a disabled extension, or a copy another
// folder shadows, supplies none, and enabling it again brings its scripts back. Scratch services; names are made up.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import type { ExtensionsListResult } from "../src/extension-registry";
import { setup, until } from "./script-harness";

function plant(folder: string, id: string, script: string, config: Record<string, unknown> = {}) {
  mkdirSync(join(folder, id, "scripts"), { recursive: true });
  writeFileSync(join(folder, id, "extension.json"), JSON.stringify({ contract: 2, id, name: id, version: 1, scripts: [{ name: script, file: `scripts/${script}.js`, about: `${script} the ${id}` }] }));
  writeFileSync(join(folder, id, "scripts", `${script}.js`), `// ep0ch-script\nreturn "${script}";\n`);
  writeFileSync(join(folder, id, "config.json"), JSON.stringify(config));
}

const scriptsListed = async (client: OutlinerClient) =>
  (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.flatMap(e => e.script && e.name && ["water", "rain"].includes(e.name) ? [e.name] : []).sort();

test("a disabled extension's scripts are not listed or runnable, and enabling it brings them back", async () => {
  const { root, client } = await setup();
  const config = join(root, "outline/extensions/garden/config.json");
  plant(join(root, "outline/extensions"), "garden", "water");
  const entry = async () => (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.find(e => e.script && e.name === "water");
  const id = (await entry())!.id;
  expect((await client.request<{ written: string[] }>({ action: "extensions.act", extension: id, extensionAction: "run" })).written).toBeDefined();
  writeFileSync(config, JSON.stringify({ enabled: false }));
  expect(await entry()).toBeUndefined();
  await expect(client.request({ action: "extensions.act", extension: id, extensionAction: "run" })).rejects.toThrow();
  writeFileSync(config, JSON.stringify({ enabled: true }));
  await until("the script back", async () => (await entry())?.id === id);
});

test("an extension another folder shadows supplies no scripts, and the winning copy's are listed", async () => {
  const { root, client } = await setup();
  plant(join(root, "user-extensions"), "garden", "rain");
  plant(join(root, "outline/extensions"), "garden", "water");
  expect(await scriptsListed(client)).toEqual(["water"]);
});
