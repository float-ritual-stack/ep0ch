import { describe, expect, test } from "bun:test";
import { doorSocketIn, reachDoor, type DoorReachIO } from "../src/door-reach";

const PLACE = "/state/sessions/local/garden";
const OWN = doorSocketIn(PLACE);
const OTHER = "/state/sessions/local/allotment/door.sock";

/** A world where `live` sockets answer and `links` maps a link to where it points. */
const io = (live: string[], links: Record<string, string> = {}): DoorReachIO => ({
  listening: async p => live.includes(p),
  linkTarget: p => links[p] ?? null,
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

  test("a link is followed first: pointing at another outline's door it is refused for the tile's own outline's; into the folder it is taken", async () => {
    const link = "/state/agent-door-pie.sock";
    const away = await reachDoor(link, PLACE, io([link, OWN], { [link]: OTHER }));
    expect(away.path).toBe(OWN);
    expect(away.stale).toContain("another outline's door");
    // A link inside the folder that points out of it is refused too.
    const sneaky = `${PLACE}/door-4242.sock`;
    expect((await reachDoor(sneaky, PLACE, io([sneaky, OWN], { [sneaky]: OTHER }))).path).toBe(OWN);
    const home = `${PLACE}/door-77.sock`;
    expect(await reachDoor(home, PLACE, io([home, OWN], { [home]: OWN }))).toMatchObject({ path: home, stale: null });
    // Without EP0CH_PLACE (the Herdr agent's pane) the link is taken as it is.
    expect((await reachDoor(link, undefined, io([link], { [link]: OTHER }))).path).toBe(link);
  });

  test("nothing answers anywhere: the outline's own socket, with no excuse", async () => {
    expect(await reachDoor(`${PLACE}/door-4242.sock`, PLACE, io([]))).toMatchObject({ path: OWN, stale: null });
  });
});
