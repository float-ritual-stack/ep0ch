import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NamedAgentPane } from "../desk/named-agent-pane";
import { hc } from "../named-agent";
import type { Section, deskOf as MakeDesk } from "./showcase";

/** An exhibit owns a private core, even when the showcase was opened from a real door. */
function namedAgentDemo(): [NamedAgentPane, NamedAgentPane] {
  const dir = mkdtempSync(join(tmpdir(), "hc-demo-"));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("HC_")) delete env[k];
  Object.assign(env, { HC_SESSION: "showcase", XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state"), XDG_RUNTIME_DIR: join(dir, "run") });
  mkdirSync(join(dir, "run"), { mode: 0o700 });
  const script = join(dir, "fern.sh");
  writeFileSync(script, '#!/bin/sh\nprintf "\\033]7501;state=idle:app=claude-code\\033\\\\"\necho "Fern is ready. Type work, ready, or quit."\nwhile IFS= read -r line; do\n case "$line" in\n  work) printf "\\033]7501;state=working:app=claude-code\\033\\\\";;\n  ready) printf "\\033]7501;state=idle:app=claude-code\\033\\\\";;\n  quit) echo "Fern finished the garden plan."; exit 7;;\n  *) echo "Fern heard: $line";;\n esac\ndone\n');
  const config = { persona: "fern", machine: "local", outline: "showcase", folder: dir, program: ["/bin/sh", script] };
  const panes: [NamedAgentPane, NamedAgentPane] = [new NamedAgentPane(config, env), new NamedAgentPane(config, env)];
  let left = panes.length;
  for (const pane of panes) {
    const dispose = pane.dispose.bind(pane);
    pane.dispose = () => { dispose(); if (--left === 0) void hc(["server", "stop"], env).catch(() => {}); };
  }
  return panes;
}

export function namedAgentSection(deskOf: typeof MakeDesk): Section {
  return {
    key: "named-agent", need: "attach a kept named agent and recover when none runs", part: "the terminal tile over hc attach, with the shared home surface and ActionSet for its card", files: "src/named-agent.ts, src/desk/named-agent-pane.ts",
    aside: "This exhibit owns a private hc core. Start Fern from the card (Enter or click). In mirror, r looks again and attaches as a watcher; it cannot resize or type into Fern. Type work, ready, or quit in Fern to report working, idle, or end with exit 7. The card keeps the final lines. Enter starts it again; s opens your login shell. act: agent.launch, agent.attach, agent.shell. Closing the exhibit stops only its private core.",
    stage(_n, show) { return deskOf({ title: "showcase · named agent", panes: namedAgentDemo(), names: ["fern", "mirror"] }, show, []); },
  };
}
