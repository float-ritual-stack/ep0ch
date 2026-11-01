import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the named agent exhibit", () => {
  const h = useShowcaseScreen();
  test("the card starts Fern, hc reports status, and the exit card starts it again or opens a shell", async () => {
    await h.app.act({ action: "section", args: { name: "named-agent" }, as: "tester" });
    await until(() => h.screen().includes("no agent named fern"), "the empty card");
    expect(h.screen()).toContain("ep0ch agent start fern");
    expect(h.screen()).toContain("a shell here");
    await h.app.act({ action: "agent.launch", tile: "fern", as: "tester" });
    await until(() => h.screen().includes("Fern is ready"), "the attached program");
    await h.app.act({ action: "agent.attach", tile: "mirror", as: "tester" });
    const mirror = await h.app.act({ action: "tile.info", tile: "mirror", as: "tester" }) as any;
    expect(mirror.namedAgent).toMatchObject({ observing: true, card: false });
    await h.app.act({ action: "tile.type", tile: "mirror", args: { text: "quit\n" }, as: "tester" });
    await h.app.act({ action: "tile.type", tile: "fern", args: { text: "work\n" }, as: "tester" });
    const facts = () => h.app.act({ action: "tile.info", tile: "fern", as: "tester" }) as Promise<any>;
    await until(() => JSON.stringify(h.app.describe()).includes('"state":"working"'), "hc program status");
    expect((await facts()).terminal.status).toEqual(expect.arrayContaining([expect.objectContaining({ state: "working" })]));
    await h.app.act({ action: "tile.type", tile: "fern", args: { text: "quit\n" }, as: "tester" });
    await until(() => h.screen().includes("ended · exit 7"), "the exit card");
    await until(() => h.screen().includes("Fern finished the garden plan"), "hc read's final lines");
    await h.app.act({ action: "agent.shell", tile: "fern", as: "tester" });
    expect(JSON.stringify(await h.app.act({ action: "layout.get", as: "tester" }))).toContain("-l");
    await h.app.act({ action: "agent.launch", tile: "fern", as: "tester" });
    await until(() => JSON.stringify(h.app.describe()).includes('"card":false'), "deliberate restart");
  }, 40_000);
});
