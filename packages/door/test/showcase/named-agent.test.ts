import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { USER } from "../../src/socket";

describe.skipIf(!outliner)("the named agent exhibit", () => {
  const h = useShowcaseScreen();
  test("the card starts Fern, hc reports status, and the exit card starts it again or opens a shell", async () => {
    await h.app.act({ action: "section", args: { name: "named-agent" }, as: "tester" });
    await until(() => h.screen().includes("no agent named fern"), "the empty card");
    expect(h.screen()).toContain("ep0ch agent start fern");
    expect(h.screen()).toContain("a shell here");
    const rows = h.screen().split("\n"), y = rows.findIndex(l => l.includes("[ep0ch agent start fern]"));
    const x = rows[y]!.indexOf("[ep0ch agent start fern]") + 2;
    h.press({ kind: "mouse", action: "down", button: 0, x, y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => h.screen().includes("Fern is ready"), "the attached program");
    await h.app.act({ action: "named.attach", tile: "mirror", as: "tester" });
    const mirror = await h.app.act({ action: "tile.info", tile: "mirror", as: "tester" }) as any;
    expect(mirror.namedAgent).toMatchObject({ observing: true, card: false });
    await h.app.act({ action: "tile.type", tile: "mirror", args: { text: "quit\n" }, as: "tester" });
    await h.app.act({ action: "tile.type", tile: "fern", args: { text: "work\n" }, as: "tester" });
    const facts = () => h.app.act({ action: "tile.info", tile: "fern", as: "tester" }) as Promise<any>;
    await until(() => JSON.stringify(h.app.describe()).includes('"state":"working"'), "hc program status");
    expect((await facts()).terminal.status).toEqual(expect.arrayContaining([expect.objectContaining({ state: "working" })]));
    await h.app.dispatch.act({ action: "tile.focus", tile: "fern" }, USER);
    await h.app.dispatch.act({ action: "tile.enter", tile: "fern" }, USER);
    for (const ch of "quit") h.ch(ch);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("ended · exit 7"), "the exit card");
    await until(() => h.screen().includes("Fern finished the garden plan"), "hc read's final lines");
    while ((await facts()).terminal.exited === null) await Bun.sleep(20);
    h.ch("s");
    await until(() => JSON.stringify(h.app.describe()).includes('"-l"'), "one key opens the login shell after an exit");
    expect(JSON.stringify(await h.app.act({ action: "layout.get", as: "tester" }))).toContain("-l");
    await h.app.act({ action: "named.start", tile: "fern", as: "tester" });
    await until(() => JSON.stringify(h.app.describe()).includes('"card":false'), "deliberate restart");
  }, 40_000);
});
