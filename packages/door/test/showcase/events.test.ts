import { connect } from "node:net";
import { describe, expect, test } from "bun:test";
import type { DoorHover, DoorOpen } from "@ep0ch/outline-core/door-open";
import { visible } from "../../src/style";
import { KeyDecoder } from "../../src/term";
import { extensionList } from "../../src/extensions";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("showcase: open events", () => {
  const h = useShowcaseScreen(177);
  test("a landing reaches the local feed, agents and the service with its cause", async () => {
    await h.app.act({ action: "section", args: { name: "events" }, as: "test-agent" });
    const desk = h.S().stages.get(h.S().sel).top;
    const local: DoorOpen[] = [], remote: DoorOpen[] = [], hovers: DoorHover[] = [];
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
          if (message.event?.door?.kind === "door.open") remote.push(message.event.door);
          if (message.event?.door?.kind === "door.hover") hovers.push(message.event.door);
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
      decoder.feed(`\x1b[<35;${hx + 1};${hy + 2}M`);
      decoder.feed(`\x1b[<35;${hx + 1};${hy + 1}M`);
      await until(() => local.at(-1)?.method === "hover", "hovering follows its wire with a hover cause");
      expect(local.at(-1)?.source?.visit).toBe(beforeHover.target.visit);
      expect(local.at(-1)?.target.tile).not.toBe(beforeHover.target.tile);
      // The hover primitive (PIE-1505): the rest on the link went out on the same wire as a door.hover, its link named.
      await until(() => hovers.some(e => e.method === "pointer" && e.link?.block === local.at(-1)?.target.note), "the service's door.hover");
      await h.app.dispatch.act({ action: "glass.mode", args: { set: "off" } }, USER);
      await desk.dispatch.act({ action: "open", args: { id: first.target.note, from: "walk", fresh: true } }, { kind: "agent", id: "garden-helper" });
      expect(local.at(-1)?.actor).toEqual({ kind: "agent", id: "garden-helper" });
      const searchNote = await h.board.createBlock(null, "The violet seed packet\nAn unmistakable search result.");
      await h.app.act({ action: "bar.pick", args: { scope: "notes", query: "violet seed packet", n: 1 }, as: "garden-helper" });
      expect(local.at(-1)?.target.note).toBe(searchNote.id);
      expect(local.at(-1)?.method).toBe("search");
      await desk.dispatch.act({ action: "open", args: { id: first.target.note }, tile: "walk" }, USER);
      await desk.dispatch.act({ action: "tile.focus", tile: "walk" }, USER);
      await until(() => { h.screen(); h.ch("]"); return walk().describeElements().some((e: { current: boolean; kind: string }) => e.current && e.kind === "link"); }, "the alternate link selected");
      h.press({ kind: "alt-enter" });
      await until(() => local.at(-1)?.method === "alt", "the alternate open's cause");
      await h.board.createBlock(null, `Trail script [script::trail-script] [results::keep] [effects::write]\n\`\`\`js\nawait act('open', {id: '${first.target.note}'});\n\`\`\``);
      await h.board.request("extensions.list", { reload: true });
      await h.app.loadExtensions(true);
      const script = extensionList()!.extensions.find(e => e.name === "trail-script")!;
      await h.app.act({ action: `ext.${script.id}.run`, as: "garden-helper" });
      await until(() => local.at(-1)?.method === "script", "the script's open cause");
      await until(() => remote.at(-1)?.target.visit === local.at(-1)?.target.visit, "all openings delivered");
      expect(remote.slice(remote.findIndex(e => e.target.visit === first.target.visit))).toEqual(local.slice(local.indexOf(first)));

    } finally { off(); observer.destroy(); }
  }, 20_000);
});
