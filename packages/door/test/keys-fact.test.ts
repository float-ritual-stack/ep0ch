// PIE-1592: the keys fact's rule for ctrl+], reachable without a terminal: it steps out one mode at a time, innermost first,
// on the screen, in the drawer and in a group; what a second press does; and a program's fact on its desk.
import { describe, expect, test } from "bun:test";
import { CHORD_MS, deskWay, DoorKeys, wayOut, type DeskWay } from "../src/desk/keys-fact";

const desk = (o: Partial<Parameters<typeof deskWay>[0]> = {}) => deskWay({ typing: false, exited: false, armed: false, inGroup: false, inner: null, ...o });
const door = (o: Partial<Parameters<typeof wayOut>[0]> = {}) => wayOut({ inDrawer: false, desk: null, drawerUp: false, leftDrawer: false, ...o });

describe("a desk's way out", () => {
  test("a program first, then its second press, then the group", () => {
    expect(desk({ typing: true })).toBe("program");
    expect(desk({ armed: true })).toBe("send");
    expect(desk({ inGroup: true })).toBe("group");
    expect(desk()).toBeNull();
  });
  test("inside a group, the group's own way comes first", () => {
    for (const inner of ["program", "send", "group"] as DeskWay[]) expect(desk({ inGroup: true, inner })).toBe(inner);
  });
  test("a group never gone into still answers for a program in it: a click put the keys there", () => {
    expect(desk({ inGroup: false, inner: "program" })).toBe("program");
    expect(desk({ inGroup: false, inner: "send" })).toBe("send");
    expect(desk({ inGroup: false, inner: null })).toBeNull();
  });
  test("a program that exited steps out of it; in a group that stays in the group", () => {
    expect(desk({ typing: true, exited: true })).toBe("exited");
    expect(desk({ inGroup: true, inner: "exited" })).toBe("program");
  });
});

describe("the door's way out", () => {
  test("in the drawer: what its desk says, else out of the drawer; a top-level program that exited leaves it", () => {
    expect(door({ inDrawer: true, desk: "program", drawerUp: true })).toBe("program");
    expect(door({ inDrawer: true, desk: "group", drawerUp: true })).toBe("group");
    expect(door({ inDrawer: true, drawerUp: true })).toBe("drawer");
    expect(door({ inDrawer: true, desk: "exited", drawerUp: true })).toBe("drawer");
  });
  test("on the screen: its program or group before the drawer that's up, one mode at a time", () => {
    expect(door({ desk: "program", drawerUp: true })).toBe("program");
    expect(door({ desk: "group", drawerUp: true })).toBe("group");
    expect(door({ desk: "send", drawerUp: true })).toBe("send");
    expect(door({ desk: "exited", drawerUp: true })).toBe("program");
    expect(door({ drawerUp: true })).toBe("into-drawer");
    expect(door()).toBe("none");
  });
  test("right after leaving the drawer, the second goes back in with a ctrl+] for its program", () => {
    expect(door({ drawerUp: true, leftDrawer: true })).toBe("drawer-send");
    expect(door({ drawerUp: false, leftDrawer: true })).toBe("none");
  });
});

describe("the record", () => {
  const prog = (running = true) => ({ running }) as never;
  test("a program left is armed for CHORD_MS, on that program only, while it runs; the drawer left likewise", () => {
    const k = new DoorKeys("screen"), d = {}, p = prog();
    k.typeIn(d, p);
    expect(k.typingOn(d)).toBe(p);
    k.leftProgram(d, p, 1000);
    expect(k.typingOn(d)).toBeNull();
    expect(k.armed(p, 1000 + CHORD_MS - 1)).toBe(true);
    expect(k.armed(p, 1000 + CHORD_MS)).toBe(false);
    expect(k.armed(prog(), 1001)).toBe(false);
    k.leftProgram(d, prog(false), 1000);
    expect(k.armed(prog(false), 1001)).toBe(false);
    k.leftDrawer(2000);
    expect(k.justLeftDrawer(2001)).toBe(true);
    expect(k.justLeftDrawer(2000 + CHORD_MS)).toBe(false);
    k.chordSpent();
    expect(k.justLeftDrawer(2001)).toBe(false);
  });
  test("each desk keeps its own program; a stop names which", () => {
    const k = new DoorKeys("screen"), a = {}, b = {}, p = prog(), q = prog();
    k.typeIn(a, p); k.typeIn(b, q);
    k.stopTyping(a, q);
    expect(k.typingOn(a)).toBe(p);
    k.stopTyping(a);
    expect([k.typingOn(a), k.typingOn(b)]).toEqual([null, q]);
  });
});
