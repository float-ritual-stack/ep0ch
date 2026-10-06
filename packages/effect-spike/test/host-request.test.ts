import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { hostRequest, type HostRequestError } from "../src/host-request";
import { fakeHost } from "./fake-host";

const dir = mkdtempSync(join(tmpdir(), "effect-spike-"));
const host = fakeHost(dir);
afterAll(() => { host.server.stop(true); rmSync(dir, { recursive: true, force: true }); });
const run = <T>(e: Effect.Effect<T, HostRequestError>) => Effect.runPromise(e);
const fails = <T>(e: Effect.Effect<T, HostRequestError>) => Effect.runPromise(Effect.flip(e));
const settled = () => new Promise(r => setTimeout(r, 20));

describe("a request to the outline host, on Effect's Socket", () => {
  test("one line out, the first line back, and the socket is closed", async () => {
    expect(await run(hostRequest(host.path, "ping"))).toEqual({ status: "ready" });
    const typed = await run(hostRequest(host.path, "ping", {}, { result: Schema.Struct({ status: Schema.Literal("ready") }) }));
    expect(typed.status).toBe("ready");
    expect((await fails(hostRequest(host.path, "ping", {}, { result: Schema.Struct({ protocolVersion: Schema.Int }) }))).message).toContain("result: Missing key");
    await settled();
    expect(host.opened).toBe(3);   // one connection per request
    expect(host.open).toBe(0);
  });

  test("a refusal is typed, with the service's words; the socket is closed", async () => {
    const e = await fails(hostRequest(host.path, "outlines.create", { name: "garden" }));
    expect(e).toMatchObject({ _tag: "Refused", action: "outlines.create", message: `"garden" exists already` });
    await settled();
    expect(host.open).toBe(0);
  });

  test("a host that never answers times out with the command to run; the socket is closed, not leaked", async () => {
    const e = await fails(hostRequest(host.path, "slow", {}, { timeoutMs: 150 }));
    expect(e).toMatchObject({ _tag: "HostSilent", timeoutMs: 150, command: "ep0ch status" });
    expect(e.message).toContain("slow timed out after 150 ms");
    await settled();
    expect(host.open).toBe(0);
  });

  test("a host that hangs up, and nobody at the socket, are both NoHost with what was seen", async () => {
    expect(await fails(hostRequest(host.path, "hangup"))).toMatchObject({ _tag: "NoHost", said: "SocketCloseError" });
    const nobody = await fails(hostRequest(join(dir, "nobody.sock"), "ping"));
    expect(nobody).toMatchObject({ _tag: "NoHost", command: "ep0ch install --apply" });
    expect(nobody.message).toContain("no outline host answers at");
  });

  test("an answer this client's protocol can't read is BadAnswer, naming the missing field", async () => {
    const e = await fails(hostRequest(host.path, "garbled"));
    expect(e._tag).toBe("BadAnswer");
    expect(e.message).toContain("answered something this client can't read");
  });
});
