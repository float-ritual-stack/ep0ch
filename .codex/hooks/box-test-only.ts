// A Codex PreToolUse hook: refuses a whole-suite `bun test` straight on float-box or float-2, naming scripts/box-test
// (PIE-998). The decision is .claude/skills/ep0ch-repo/hooks/whole-suite.ts (the Claude plugin loader cannot import from outside its folder, so the code lives there), the same function the Claude mod asks, so the two tools
// never disagree. Codex hooks are a guardrail, not a boundary (they fail open): scripts/box-test enforces the limits
// itself for every tool. Input: the hook JSON on stdin; a refusal is the documented permissionDecision "deny" on stdout.
import { hostname } from "node:os";
import { codexPreToolUse } from "../../.claude/skills/ep0ch-repo/hooks/whole-suite";

const answer = codexPreToolUse(await Bun.stdin.text(), { hostname: hostname() });
if (answer) console.log(answer);
