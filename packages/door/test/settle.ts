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
      // Woken by the last answer, or after 10 ms to look at busy() again; never past the end (one timer at a time).
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([...(hostTraffic.waiting > 0 ? [hostsIdle()] : []), new Promise<void>(r => { timer = setTimeout(r, Math.max(0, Math.min(end - Date.now(), hostTraffic.waiting > 0 ? 3000 : 10))); })]);
      clearTimeout(timer);
      await Bun.sleep(0);
    }
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
  };
  return { settle, asked: () => hostTraffic.asked - from };
}
