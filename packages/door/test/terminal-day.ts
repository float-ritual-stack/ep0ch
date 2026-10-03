// A layout for tests that need a terminal tile beside the notes: the daily layout with a shell named claude over
// the now tile, as the daily layout had before the agent moved to the host layer (PIE-513). A terminal the person
// made themselves, so it stays (withoutAgentTile leaves out only the agent tile). Saved under the door's state
// (EP0CH_STATE), so call it once that's set.
import { builtin, saveLayout } from "../src/desk/tiles";

export function terminalDay(cmd = (process.env.EP0CH_DAILY_AGENT || "sh").split(/\s+/).filter(Boolean)): string {
  const d = builtin("daily")!;
  const root = JSON.parse(JSON.stringify(d.root));
  root.kids[0] = { t: "split", dir: "col", kids: [{ t: "leaf", kind: "pty", name: "claude", cmd, link: "middle" }, root.kids[0]], weights: [0.6, 0.4] };
  const { policy: _policy, ...rest } = d;
  saveLayout("terminal-day", { ...rest, name: "terminal-day", root });
  return "terminal-day";
}
