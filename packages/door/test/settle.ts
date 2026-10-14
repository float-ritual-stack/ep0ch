// When the door is settled for a probe (test/parity.ts): no answer from an outline host is awaited, whichever way it
// was asked (src/socket.ts hostTraffic: a board's request, hostRequest), and nothing the screen says it's still asking
// for (`busy`: the power bar's sources, one of which waits for typing to pause before it asks). `settle()` waits, at
// most 3 s, until neither is, woken when the last answer comes; `asked()` counts the round trips since `watchHosts()`.
import { hostsIdle, hostTraffic } from "../src/socket";

export function watchHosts(busy: () => boolean = () => false) {
  const from = hostTraffic.asked;
  const settle = async () => {
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
    const end = Date.now() + 3000;
    while ((hostTraffic.waiting > 0 || busy()) && Date.now() < end) {
      await Promise.race([hostTraffic.waiting > 0 ? hostsIdle() : Bun.sleep(10), Bun.sleep(Math.max(0, end - Date.now()))]);
      await Bun.sleep(0);
    }
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
  };
  return { settle, asked: () => hostTraffic.asked - from };
}
