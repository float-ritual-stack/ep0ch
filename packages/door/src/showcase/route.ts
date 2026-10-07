import { screenArg } from "../cli-words";

/**
 * `ep0ch --showcase [--reset]` with no --ws: the arguments `scripts/try-it.sh` takes for the seeded showcase
 * outline, or null when the showcase isn't asked for, or --ws names the outline to show it on (try-it.sh's own
 * call). --reset reseeds it. `--screen <name> [<target>]` goes along: that screen opens over the main menu on the
 * showcase outline (not the showcase's own section list: `ep0ch --showcase` alone lands there).
 */
export function showcaseTry(args: readonly string[]): string[] | null {
  if (!args.includes("--showcase") || args.includes("--ws")) return null;
  const screen = screenArg(args);
  return ["--showcase", ...(args.includes("--reset") ? ["--reset"] : []), ...(screen ? ["--screen", screen.name, ...(screen.target ? [screen.target] : [])] : [])];
}
