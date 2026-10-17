// A Codex PreToolUse hook: refuses a whole-suite `bun test` straight on float-box or float-2, naming scripts/box-test
// (PIE-998). It asks the same pure function the Claude mod does (.claude/skills/ep0ch-repo/hooks/guards.ts), so the two
// tools never disagree. Codex hooks are a guardrail, not a boundary (they fail open): scripts/box-test enforces the
// limits itself for every tool. Input is the hook JSON on stdin (tool_input.command); a refusal is the documented
// permissionDecision "deny" on stdout. Anything this can't read allows the call.
import { hostname } from "node:os";
import { wholeSuiteRefusal } from "../../.claude/skills/ep0ch-repo/hooks/guards";

try {
  const event = JSON.parse(await Bun.stdin.text()) as { tool_name?: string; tool_input?: { command?: unknown } };
  const command = event.tool_input?.command;
  const why = typeof command === "string" ? wholeSuiteRefusal(command, { hostname: hostname() }) : null;
  if (why) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } }));
} catch {
  // Not a Bash event, or unreadable: let it run.
}
