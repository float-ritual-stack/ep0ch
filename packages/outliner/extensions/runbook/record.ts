import type { RunbookStep } from "@ep0ch/outline-core/runbook";
const inertFence = (text: string) => { const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1))); return `${fence}text\n${text}\n${fence}`; };
export function recordText(step: RunbookStep, args: Record<string, string>, by: string): string {
  const output = (args.output ?? "").trimEnd().slice(-12000);
  return `${step.shell ? `Run ${step.title}` : step.title} [type::run] [machine::runbook] [run.step::^${step.anchor}] [run.status::${args.status}]${args.exit !== undefined ? ` [run.exit::${args.exit}]` : ""} [run.at::${args.at}] [run.by::${by}] [run.owner::${args.owner}] [run.cwd::${(args.cwd ?? "").replace(/[\r\n\]]/g, " ")}] [run.vars::${step.variables.join(",")}]\n` +
    `Started: ${args.at}\n${args.end ? `Ended: ${args.end}\n` : ""}` +
    `\nMasking is best-effort. The terminal shows what the program prints.\n\n${inertFence(output || "(no output)")}`;
}
