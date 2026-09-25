import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceExtensionRuntime } from "../src/resource-extensions";

// A real, standalone program: no private imports and no in-process fake plugin.
const program = `const request=await Bun.stdin.json();
if(request.config.mode==='hang')await new Promise(()=>{});
if(request.config.mode==='large'){console.log('x'.repeat(1100000));process.exit(0);}
if(request.config.mode==='malformed'){console.log('not json');process.exit(0);}
if(request.config.mode==='error'){console.log(JSON.stringify({ok:false,code:'forbidden'}));process.exit(0);}
console.log(JSON.stringify({ok:true,value:{generation:'ONE',input:request.input,secret:request.credentials.token??null}}));`;

test("installed process lifecycle rejects invalid, disabled, stale, oversized and cancelled results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "resource-extension-"));
  const manifest = join(dir, "manifest.json"),
    entry = join(dir, "entry.ts"),
    config = join(dir, "config.json");
  const declaration = {
    contract: 1,
    id: "test.external",
    version: 1,
    command: [process.execPath, entry],
    configSchema: {
      type: "object",
      properties: { mode: { type: "string" } },
      required: ["mode"],
      additionalProperties: false,
    },
  };
  const registry = (mode: string, enabled = true) => ({
    version: 1,
    providers: {
      jira: { manifest, enabled, config: { mode }, credentials: {} },
    },
  });
  const write = async (mode: string, enabled = true) =>
    writeFile(config, JSON.stringify(registry(mode, enabled)));
  const runtime = new ResourceExtensionRuntime(config, 250);
  try {
    await writeFile(entry, program);
    await writeFile(manifest, JSON.stringify(declaration));
    await write("normal");
    expect(
      (await runtime.invoke("jira", "read", { entityId: "10001" })).value,
    ).toMatchObject({ generation: "ONE", input: { entityId: "10001" } });
    await writeFile(entry, program.replace("'ONE'", "'TWO'"));
    expect((await runtime.invoke("jira", "read", {})).value).toMatchObject({
      generation: "TWO",
    });
    await write("normal", false);
    await expect(runtime.invoke("jira", "read", {})).rejects.toThrow(
      "disabled",
    );
    await write("normal");
    await expect(runtime.invoke("jira", "read", {})).resolves.toBeDefined();
    for (const [mode, error] of [
      ["hang", "timed out"],
      ["large", "exceeds"],
      ["malformed", "invalid JSON"],
      ["error", "403"],
    ] as const) {
      await write(mode);
      await expect(runtime.invoke("jira", "read", {})).rejects.toThrow(error);
    }
    await writeFile(manifest, JSON.stringify({ ...declaration, contract: 99 }));
    await expect(runtime.invoke("jira", "read", {})).rejects.toThrow(
      "contract 1",
    );
    await writeFile(manifest, JSON.stringify(declaration));
    const missing = registry("normal");
    missing.providers.jira.credentials = Object.assign(
      {},
      { token: { env: "OUTLINER_TEST_MISSING_CREDENTIAL_380" } },
    );
    await writeFile(config, JSON.stringify(missing));
    await expect(runtime.invoke("jira", "read", {})).rejects.toThrow(
      "credentials are unavailable",
    );
    await write("normal");
    await writeFile(
      entry,
      `await Bun.stdin.json();await Bun.write(${JSON.stringify(join(dir, "started"))},'yes');while(!(await Bun.file(${JSON.stringify(join(dir, "release"))}).exists()))await Bun.sleep(5);console.log(JSON.stringify({ok:true,value:'late'}));`,
    );
    const inFlight = runtime.invoke("jira", "read", {}).then(
      () => null,
      (error) => error,
    );
    for (
      let i = 0;
      i < 100 && !(await Bun.file(join(dir, "started")).exists());
      i++
    )
      await Bun.sleep(2);
    expect(await Bun.file(join(dir, "started")).exists()).toBe(true);
    await write("normal", false);
    await writeFile(join(dir, "release"), "go");
    expect(await inFlight).toBeInstanceOf(Error);
    expect((await inFlight).message).toContain("disabled");
    await write("normal");
    await rm(join(dir, "started"));
    await rm(join(dir, "release"));
    const abort = new AbortController();
    const running = runtime.invoke("jira", "read", {}, abort.signal).then(
      () => null,
      (error) => error,
    );
    for (
      let i = 0;
      i < 100 && !(await Bun.file(join(dir, "started")).exists());
      i++
    )
      await Bun.sleep(2);
    expect(await Bun.file(join(dir, "started")).exists()).toBe(true);
    abort.abort();
    expect((await running).message).toContain("cancelled");
    await writeFile(entry, program);
    const secret = 'synthetic-"quoted"-\\token';
    process.env.OUTLINER_TEST_ESCAPED_CREDENTIAL_380 = secret;
    try {
      const secured = registry("normal");
      secured.providers.jira.credentials = Object.assign(
        {},
        { token: { env: "OUTLINER_TEST_ESCAPED_CREDENTIAL_380" } },
      );
      await writeFile(config, JSON.stringify(secured));
      const response = await runtime.invoke("jira", "read", {});
      expect(response.value).toMatchObject({ secret: "[redacted]" });
    } finally {
      delete process.env.OUTLINER_TEST_ESCAPED_CREDENTIAL_380;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
