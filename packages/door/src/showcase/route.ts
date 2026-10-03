/**
 * `ep0ch --showcase [--reset]` with no --ws: the arguments `scripts/try-it.sh` takes for the seeded showcase
 * outline, or null when the showcase isn't asked for, or --ws names the outline to show it on (try-it.sh's own
 * call). --reset reseeds it.
 */
export function showcaseTry(args: readonly string[]): string[] | null {
  if (!args.includes("--showcase") || args.includes("--ws")) return null;
  return ["--showcase", ...(args.includes("--reset") ? ["--reset"] : [])];
}
