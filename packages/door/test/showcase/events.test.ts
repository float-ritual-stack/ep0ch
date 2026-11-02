import { connect } from "node:net";
import { describe, expect, test } from "bun:test";
import type { DoorOpen } from "@ep0ch/outline-core/door-open";
import { visible } from "../../src/style";
import { KeyDecoder } from "../../src/term";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("showcase: open events", () => {
  const h = useShowcaseScreen(177);
  test("a landing reaches the local feed, agents and the service with its cause", async () => {
    await h.app.act({ action: "section", args: { name: "events" }, as: "test-agent" });
    const desk = h.S().stages.get(h.S().sel).top;
    const local: DoorOpen[] = [], remote: DoorOpen[] = [];
    const off = h.app.subscribe(e => { if (e.type === "door.open") local.push(e as unknown as DoorOpen); });
    const observer = connect(h.scratch.sock);
    let buffer = "";
    await new Promise<void>((resolve, reject) => {
      observer.on("error", reject);
      observer.on("data", data => {
        buffer += data;
        for (;;) {
          const n = buffer.indexOf("\n"); if (n < 0) break;
          const message = JSON.parse(buffer.slice(0, n)); buffer = buffer.slice(n + 1);
          if (message.result?.subscribed) resolve();
          if (message.event?.open) remote.push(message.event.open);
        }
      });
      observer.write(JSON.stringify({ id: "subscribe", action: "events.subscribe", client: { clientId: "trail-observer", contextId: "garden", role: "observer" } }) + "\n");
    });
    try {
      await desk.dispatch.act({ action: "open", args: { id: h.seeded.notes.trailGate.id }, tile: "walk" }, USER);
      const answer = await h.app.act({ action: "door.opens", args: { since: 0 }, as: "test-agent" }) as DoorOpen[];
      expect(answer.at(-1)?.target.note).toBe(h.seeded.notes.trailGate.id);
      await until(() => remote.at(-1)?.target.visit === local.at(-1)?.target.visit, "the service's door event");
      expect(remote.at(-1)).toEqual(local.at(-1));
      expect(local.at(-1)?.target.visit).toBeTruthy();
      const first = local.at(-1)!;
      h.press({ kind: "enter" });
      await desk.dispatch.act({ action: "tile.focus", tile: "walk" }, USER);
      const walk = () => desk.paneNamed("walk").surface;
      await until(() => { h.screen(); h.ch("]"); return walk().describeElements().some((e: { current: boolean; kind: string }) => e.current && e.kind === "link"); }, "the link selected by key");
      h.press({ kind: "enter" });
      await until(() => local.some(e => e.source?.visit === first.target.visit && e.method === "link"), "the key's link event");
      const second = local.at(-1)!;
      await until(() => h.screen().includes("Walk on: the orchard"), "the next link drawn");
      const lines = h.screen().split("\n"), y = lines.findIndex(line => line.includes("Walk on: the orchard"));
      const x = lines[y]!.indexOf("the orchard") + 2;
      h.press({ kind: "mouse", action: "down", button: 0, x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x, y });
      await until(() => local.some(e => e.source?.visit === second.target.visit && e.method === "link"), "the click's link event");
      expect(local.at(-1)?.source?.note).toBe(second.target.note);
      await desk.dispatch.act({ action: "back", tile: "walk" }, USER);
      expect(local.at(-1)?.method).toBe("back");
      await desk.dispatch.act({ action: "forward", tile: "walk" }, USER);
      expect(local.at(-1)?.method).toBe("forward");
      await desk.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "hover", where: "down" }, tile: "walk" }, USER);
      await desk.dispatch.act({ action: "tile.link", args: { to: "hover", verb: "hover" }, tile: "walk" }, USER);
      await h.app.dispatch.act({ action: "glass.mode", args: { set: "on" } }, USER);
      await h.app.dispatch.act({ action: "glass.tune", args: { name: "open", value: 80 } }, USER);
      const beforeHover = local.at(-1)!;
      h.app.flush();
      const drawn = h.painted.map(visible), hy = drawn.findIndex(line => line.includes("Walk on: the shed"));
      expect(hy).toBeGreaterThan(-1);
      const hx = drawn[hy]!.indexOf("the shed") + 2;
      const decoder = new KeyDecoder(h.app.terminalSize); decoder.keyHandler = h.press;
      decoder.feed(`\x1b[<35;${hx + 1};${hy + 1}M`);
      await h.app.dispatch.act({ action: "text.hover", args: { x: hx, y: hy } }, USER);
      await until(() => local.at(-1)?.method === "hover", "hovering follows its wire with a hover cause").catch(e => { console.log({ hit: desk.hoverAt(hx - desk.screenOrigin.col, hy - desk.screenOrigin.row), events: local.slice(-2), mouse: h.app.glass.describe() }); throw e; });
      expect(local.at(-1)?.source?.visit).toBe(beforeHover.target.visit);
      expect(local.at(-1)?.target.tile).not.toBe(beforeHover.target.tile);
      await h.app.dispatch.act({ action: "glass.mode", args: { set: "off" } }, USER);
      await desk.dispatch.act({ action: "open", args: { id: first.target.note, from: "walk", fresh: true } }, { kind: "agent", id: "garden-helper" });
      expect(local.at(-1)?.actor).toEqual({ kind: "agent", id: "garden-helper" });
      await until(() => remote.at(-1)?.target.visit === local.at(-1)?.target.visit, "all openings delivered");
      expect(remote.slice(remote.findIndex(e => e.target.visit === first.target.visit))).toEqual(local.slice(local.indexOf(first)));

    } finally { off(); observer.destroy(); }
  });
});
