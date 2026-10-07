import { describe, expect, test } from "bun:test";
import { doorSocketIn, reachDoor, type DoorReachIO } from "../src/door-reach";

const PLACE = "/state/sessions/local/garden";
const OWN = doorSocketIn(PLACE);
const OTHER = "/state/sessions/local/allotment/door.sock";

/** A world where `live` sockets answer and `links` are links. */
const io = (live: string[], links: string[] = []): DoorReachIO => ({
  listening: async p => live.includes(p),
  isLink: p => links.includes(p),
});

describe("which door a tile's program reaches (PIE-604)", () => {
  test("without EP0CH_PLACE, EP0CH_CONTROL as it is (an older door, or a test door's moved socket)", async () => {
    expect(await reachDoor("/tmp/test/door.sock", undefined, io([]))).toEqual({ path: "/tmp/test/door.sock", given: "/tmp/test/door.sock", place: null, stale: null });
    expect((await reachDoor(undefined, "", io([]))).path).toBeNull();
  });

  test("the socket it was given, while it answers from the outline's folder", async () => {
    const pid = `${PLACE}/door-4242.sock`;
    expect(await reachDoor(pid, PLACE, io([pid, OWN]))).toMatchObject({ path: pid, stale: null });
    expect(await reachDoor(OWN, PLACE, io([OWN]))).toMatchObject({ path: OWN, stale: null });
  });

  test("a session handed over: the door-<pid>.sock it started with is gone, and the outline's door.sock answers", async () => {
    const r = await reachDoor(`${PLACE}/door-4242.sock`, PLACE, io([OWN]));
    expect(r.path).toBe(OWN);
    expect(r.stale).toContain("has no door now");
  });

  test("EP0CH_CONTROL naming another outline's door is never used: the tile's own outline's door, or none", async () => {
    const r = await reachDoor(OTHER, PLACE, io([OTHER, OWN]));
    expect(r.path).toBe(OWN);
    expect(r.stale).toContain("another outline's door");
    // Its own outline has no door running: that is the answer, not the other door.
    expect((await reachDoor(OTHER, PLACE, io([OTHER]))).path).toBe(OWN);
  });

  test("a link (re-pointed by whichever door attaches it) is taken while it answers", async () => {
    const link = "/state/agent-door-pie.sock";
    expect(await reachDoor(link, PLACE, io([link, OWN], [link]))).toMatchObject({ path: link, stale: null });
  });

  test("nothing answers anywhere: the outline's own socket, with no excuse", async () => {
    expect(await reachDoor(`${PLACE}/door-4242.sock`, PLACE, io([]))).toMatchObject({ path: OWN, stale: null });
  });
});
