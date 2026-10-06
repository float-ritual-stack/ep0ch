// A layout for tests that need a terminal tile beside the notes: the daily layout with a shell named claude over
// the now tile, as the daily layout had before the agent moved to the host layer (PIE-513). A terminal the person
// made themselves, so it stays (withoutAgentTile leaves out only the agent tile). Registered as a screen note this door
// read (PIE-565), with a made-up note id: what `layout.load name=terminal-day` and `new Desk(…, { layout })` find.
import { builtin } from "../src/desk/tiles";
import { register } from "../src/desk/screen-notes";

export function terminalDay(cmd = (process.env.EP0CH_DAILY_AGENT || "sh").split(/\s+/).filter(Boolean)): string {
  const d = builtin("daily")!;
  const root = JSON.parse(JSON.stringify(d.root));
  root.kids[0] = { t: "split", dir: "col", kids: [{ t: "leaf", kind: "pty", name: "claude", cmd, link: "middle" }, root.kids[0]], weights: [0.6, 0.4] };
  const { policy: _policy, ...rest } = d;
  register({ name: "terminal-day", id: "00000000-0000-4000-8000-00000000da11", revision: 1, spec: { name: "terminal-day", title: "terminal-day", layouts: true, layout: { ...rest, name: "terminal-day", root } } });
  return "terminal-day";
}
