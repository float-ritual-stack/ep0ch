/**
 * The freshness sweep agent's PreToolUse hook on Bash (registered with the agent in hooks/register.ts): a command
 * that writes is refused (exit 2, the reason on stderr, which Claude Code hands the agent); a read runs. The rule is
 * hooks/freshness.ts's bashReadRefusal, the one the mod's tests check.
 */
import { bashReadRefusal } from '../hooks/freshness'

const input = JSON.parse(await Bun.stdin.text()) as { tool_input?: { command?: unknown } }
const why = bashReadRefusal(String(input.tool_input?.command ?? ''))
if (why) {
  console.error(`The freshness sweep only reads (${why}). Put it in your findings instead: the main thread makes the change.`)
  process.exit(2)
}
