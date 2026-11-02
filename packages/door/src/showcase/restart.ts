// A made-up Claude for the restart section and its tests (PIE-1280): a `claude` that keeps a status file as Claude Code
// does (`<CLAUDE_CONFIG_DIR>/sessions/<pid>.json`, idle between turns, busy in one), says when it started and with
// which arguments, and leaves on /exit. Its config folder is its own, never the person's ~/.claude: `claude agents`
// there never lists it.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PtyPane } from "../desk/pty";
import { ReaderPane } from "../desk/panes";
import { stateDir } from "../state";
import type { Section, deskOf as MakeDesk, fill as Fill, row as Row } from "./showcase";

export const FAKE_CLAUDE_SESSION = "5eed5eed-0000-4000-8000-000000000001";

const SCRIPT = `#!/bin/sh
d="\${CLAUDE_CONFIG_DIR:?}/sessions"; mkdir -p "$d"; f="$d/$$.json"
st() { printf '{"pid":%s,"sessionId":"%s","kind":"interactive","name":"%s","status":"%s"}\\n' $$ "\${FAKE_CLAUDE_SESSION:-${FAKE_CLAUDE_SESSION}}" "\${FAKE_CLAUDE_NAME:-kitty}" "$1" > "$f"; }
case " $* " in *" --resume "*) [ -n "\${FAKE_CLAUDE_REFUSE:-}" ] && { echo "a made-up claude that won't resume"; exit 1; } ;; esac
st idle
trap 'rm -f "$f"; echo "SIGTERM: gone mid-turn"; exit 143' TERM
trap 'rm -f "$f"; exit 129' HUP
echo "a made-up claude, pid $$, started $(date +%H:%M:%S), args:$*: BELOW_GUARD=\${BELOW_GUARD:-unset}"
echo "type turn (it is busy), done (idle again), /exit (it leaves)"
while IFS= read -r line; do
  case "$line" in
    */exit) rm -f "$f"; echo "bye"; exit 0 ;;
    *turn*) st busy; echo "working on a turn" ;;
    *done*) st idle; echo "turn done" ;;
    *) echo "you said: $line" ;;
  esac
done
rm -f "$f"
`;

/** Writes the made-up `claude` and its own config folder (under the door's state, or `root`): its path and the folder. */
export function fakeClaude(root = join(stateDir(), "showcase-claude")): { cmd: string; config: string } {
  const bin = join(root, "bin"), config = join(root, "config");
  mkdirSync(bin, { recursive: true }); mkdirSync(config, { recursive: true });
  const cmd = join(bin, "claude");
  writeFileSync(cmd, SCRIPT);
  chmodSync(cmd, 0o755);
  return { cmd, config };
}

/**
 * The terminal sections: the terminal tile itself, then restarting its program (PIE-1280: kitty, a made-up claude,
 * restarted in place).
 */
export function terminalSections({ deskOf, row, fill }: { deskOf: typeof MakeDesk; row: typeof Row; fill: typeof Fill }): Section[] {
  return [{
    key: "terminal", need: "run a program beside the notes (nvim, claude, a shell)", part: "the terminal tile: a pty (Bun.Terminal) drawn through @xterm/headless; click or ⏎ types in it, ctrl+] leaves; $EDITOR on a draft runs in one (a reader's ctrl+e, a draft's ctrl+x ctrl+e); its program's copy (OSC 52, Claude Code's) goes on to your clipboard through App.copy if you typed or clicked in the tile within 2 min, said \"copied from <tile>\" (or why not); drag across its text and the door selects and copies it itself (PIE-716), in the drawer too: shift+drag (alt+drag where your terminal keeps shift) when its program has the mouse", files: "src/desk/pty.ts, src/surface/editor.ts, src/surface/selection.ts",
    aside: "The shell prints an OSC 8 link: use your terminal's link gesture on Example website » to open it in your browser. Resize the tile or scroll away and back: the link stays inside its text. Drag across the line in the shell: it's selected and copied when you let go (\"copied from sh\"), as in a reader; a program that has asked for the mouse (Claude Code's fullscreen, vim's mouse=a) keeps plain drags, and shift+drag or alt+drag selects for the door · `act terminal.copy tile=<tile>` copies the person's selection again (never an agent's) · the drawer (next section; src/drawer.ts, PIE-498) runs your agents too, each in a tab of its own, pulled up over (or beside) any screen, this one too, by alt+a or a click on the status bar's ▲ chip; ctrl+] gives the keys back, alt+A or its top edge sizes it (host.toggle, host.size) · where a program runs: EP0CH_NEST, ep0ch where · find its source: type echo $EP0CH_SOURCE or ep0ch where --source; read AGENTS.md there · over MCP, list_outlines points to ep0ch://skills/whats-moving for recent activity",
    stage(n, show) {
      const term = new PtyPane({ cmd: ["sh", "-c", "echo 'a terminal tile: sh in a pty the door owns'; printf '\\033]8;id=example;https://example.com\\033\\\\Example website »\\033]8;;\\033\\\\\\n'; echo 'drag across this line: Plant out the courgettes'; echo 'copy from it as Claude Code does:'; printf '%s\\n' \"  printf '\\\\033]52;c;%s\\\\007' \\\"\\$(printf hello | base64)\\\"\"; exec sh"], label: "shell" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · terminal", panes: [r, term], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) fill(d, n.notebook); });
    },
  }, {
    key: "restart", need: "restart the program in a terminal tile while it runs (a Claude after a ~/.bashrc change or a Claude Code update), keeping its conversation",
    part: "tile.restart (PIE-1280): PtyPane.restartRunning ends it gently (a Claude between turns is sent /exit, one mid-turn SIGTERM, anything else SIGTERM then SIGKILL) and starts the same command in the same tile, an agent inside an interactive login shell (inLoginShell's -i) so a changed ~/.bashrc counts, a bare claude with --continue; agent.restart restarts the drawer's agent the same way; an agent's is refused mid-turn unless now=true; ep0ch agent restart <name> finds a Claude's tile (scripts/agent-restart: its terminal host's session folder, door.sock, host.tileOf pid=) and runs it after the same wait as a background session",
    files: "src/desk/pty.ts (restartRunning), src/desk/pty-actions.ts (tile.restart), src/desk/drawer-program.ts (inLoginShell), scripts/agent-restart, src/agent-fleet.ts",
    aside: "kitty runs a made-up claude (its own status file, never your ~/.claude): ^W R, or kitty's menu (^W .) restart its program, ends it with /exit and starts it again: the started time changes, the pid too · type turn in it (click, then turn ⏎, ctrl+] back) and run act tile.restart tile=kitty as an agent: refused mid-turn; now=true goes anyway and says it dropped the turn · from a shell: ep0ch agent restart <name> --dry-run says the tile it would restart; ep0ch agent ls says where each Claude runs",
    stage(n, show) {
      const fake = fakeClaude(), kitty = new PtyPane({ cmd: [fake.cmd], label: "kitty", own: { CLAUDE_CONFIG_DIR: fake.config } }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · restart", panes: [r, kitty], names: ["reader", "kitty"], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) fill(d, n.notebook); });
    },
  }];
}
