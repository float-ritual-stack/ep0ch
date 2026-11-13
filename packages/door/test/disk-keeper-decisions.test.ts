// The disk keeper's decisions on a described history (PIE-1787): when it alerts, when it alerts again, what it names.
import { describe, expect, test } from "bun:test";
import { DEFAULTS, diskIncidents, escalate, growth, ownerOf, parseDf, parsePlaces, type Sample } from "../src/disk/keeper";
import { alertMark } from "../src/backup/alert";

const G = 1024 ** 3, M = 1024 ** 2;
const SIZE = 40 * G;
const at = (h: number) => new Date(Date.UTC(2026, 10, 12, 0, 0) + h * 3_600_000).toISOString();
const s = (h: number, usedG: number, places?: Record<string, number>): Sample => ({ at: at(h), mount: "/", size: SIZE, used: usedG * G, avail: SIZE - usedG * G, ...(places ? { places } : {}) });
const look = (samples: Sample[], now = 24) => diskIncidents({ machine: "box-a", samples, sweeps: [], mount: "/", t: DEFAULTS, now: Date.parse(at(now)) });

describe("what the keeper raises", () => {
  test("85% names what grew in the last day and who reclaims it; the fix is the one it can't move", () => {
    const found = look([
      s(0, 30, { "~/.claude/projects": 1 * G, "/var/log/journal": 1 * G, "~/box": 2 * G }),
      s(24, 34.5, { "~/.claude/projects": 2 * G, "/var/log/journal": 3 * G, "~/box": 2 * G + 10 * M }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe("disk:box-a:/:full");
    expect(found[0]!.detail).toContain("+2.1 GB /var/log/journal (journald's cap, can't be moved)");
    expect(found[0]!.detail).toContain("~/.claude/projects (offload's sweep, which moves it)");
    expect(found[0]!.detail).not.toContain("~/box");
    expect(found[0]!.fix).toContain("SystemMaxUse=");
  });

  test("a fast fill is an incident at any share: 42% full, gaining 2.5 GB an hour", () => {
    const found = look([s(22, 12), s(23, 14, { "~/grow": 1 * G }), s(24, 16.5, { "~/grow": 3 * G })]);
    expect(found.map(i => i.key)).toEqual(["disk:box-a:/:rate"]);
    expect(found[0]!.title).toBe("/ on box-a fills in about 9 hours");
    expect(found[0]!.detail).toContain("+2.1 GB ~/grow (nobody: reported)");
    expect(found[0]!.fix).toStartWith("du -xh -d1 ~/grow");
  });

  test("slow growth on a roomy disk: nothing", () => {
    expect(look([s(23, 12), s(24, 12.1)])).toEqual([]);
  });

  test("one alert per incident; again only when it gets worse, never for the same or a better reading", () => {
    const at88 = look([s(23, 35.2), s(24, 35.2)]);
    const first = escalate({}, at88);
    expect(first.announce).toHaveLength(1);
    expect(escalate(first.announced, at88).announce).toEqual([]);
    const at96 = look([s(23, 38.4), s(24, 38.4)]);
    const worse = escalate(first.announced, at96);
    expect(worse.announce.map(i => i.title)).toEqual(["/ on box-a is 96% full"]);
    const back = escalate(worse.announced, at88);
    expect(back.announce).toEqual([]);
    // Cleared, then back: a new incident, announced once more.
    const cleared = escalate(back.announced, []);
    expect(escalate(cleared.announced, at88).announce).toHaveLength(1);
  });

  test("the status bar says disk, not backup, for the keeper's incident", () => {
    const [i] = look([s(23, 35.2), s(24, 35.2)]);
    expect(alertMark({ machine: "box-a", checkedAt: at(24), incidents: [i!], announced: [] }, Date.parse(at(24)))!.text).toBe("✗ disk");
  });
});

describe("what it reads", () => {
  test("df's rows in the order asked, in bytes", () => {
    const rows = parseDf("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 750 250 75% /\n/dev/sdb 2000 100 1900 5% /mnt/vol one\n");
    expect(rows).toEqual([{ mount: "/", size: 1000 * 1024, used: 750 * 1024, avail: 250 * 1024 }, { mount: "/mnt/vol one", size: 2000 * 1024, used: 100 * 1024, avail: 1900 * 1024 }]);
  });

  test("du's lines as places: the deepest folders, and a folder's own files beside them", () => {
    const p = parsePlaces(["300\t/var/log/journal", "450\t/var/log"].join("\n"), "/var/log", 1, "/home/someone");
    expect(p).toEqual({ "/var/log/journal": 300 * 1024, "/var/log (files)": 150 * 1024 });
    const h = parsePlaces(["10\t/home/someone/.claude/projects", "5\t/home/someone/.claude/remote", "20\t/home/someone/.claude", "7\t/home/someone/notes", "40\t/home/someone"].join("\n"), "/home/someone", 2, "/home/someone");
    expect(h).toEqual({ "~/.claude/projects": 10240, "~/.claude/remote": 5120, "~/.claude (files)": 5120, "~/notes": 7168, "~ (files)": 13312 });
  });

  test("owners by the longest path; anything else is reported, with the command that looks", () => {
    expect(ownerOf("~/.claude/remote").moves).toBe(true);
    expect(ownerOf("~/.local/state/ep0ch-door/backup").owner).toContain("PIE-1786");
    expect(ownerOf("/var/log (files)").owner).toBe("logrotate");
    expect(ownerOf("~/.codex").owner).toBe("nobody");
  });

  test("growth compares with the sample nearest a day before", () => {
    const g = growth([s(0, 1, { "~/a": 1 * G }), s(12, 1, { "~/a": 5 * G }), s(24, 1, { "~/a": 2 * G })], "/", 24 * 3_600_000, 0);
    expect(g.map(x => [x.place, x.bytes])).toEqual([["~/a", 1 * G]]);
  });
});
