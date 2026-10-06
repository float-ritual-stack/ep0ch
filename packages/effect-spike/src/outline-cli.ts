// Slice D of the Effect 4 spike (not for merge): `ep0ch outline list | create <name> | delete <name> [--yes]` on
// `effect/cli`, against the door's hand-rolled parser (packages/door/src/outlines.ts `parseOutlineArgs`, 60 lines of
// `args.includes` and `switch`, plus cli-words.ts's own edit-distance "closest word" for typos, 145 lines).
//
// What the module gives for free: typed flags and arguments, a Schema on each (an outline name, an ssh machine name),
// `--help` and `--version`, "Did you mean this?" on an unknown subcommand or flag, examples, completions. What it costs:
// its `Environment` (FileSystem, Path, Terminal, ChildProcessSpawner, Stdio), which the Bun layer provides in one line
// and a test stubs in ten.
import * as Context from "effect/Context";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import { isMachineName, MACHINE_NAME_PATTERN } from "@ep0ch/outline-core/outline-location";
import { OUTLINE_NAME_PATTERN } from "@ep0ch/outline-core/protocol";
import { hostRequest } from "./host-request";

/** Which host's socket the commands ask: a Reference, so a test or `--machine` can swap it without a parameter. */
export const HostSocket = Context.Reference<string>("ep0ch/effect-spike/HostSocket", { defaultValue: () => "/nowhere/host.sock" });

const OutlineName = Schema.String.check(Schema.makeFilter(n => OUTLINE_NAME_PATTERN.test(n) || `an outline name: lowercase letters, digits and hyphens, up to 32 (${OUTLINE_NAME_PATTERN.source})`));
const MachineName = Schema.String.check(Schema.makeFilter(m => isMachineName(m) || `an ssh config name (a Host in ~/.ssh/config, ${MACHINE_NAME_PATTERN.source})`));

const HostedOutline = Schema.Struct({ name: Schema.String, database: Schema.String, folder: Schema.String, open: Schema.Boolean, default: Schema.optionalKey(Schema.Boolean) });
const HostedOutlineList = Schema.Struct({ defaultOutline: Schema.optionalKey(Schema.String), outlines: Schema.mutable(Schema.Array(HostedOutline)) });

const outline = Command.make("outline").pipe(
  Command.withSharedFlags({
    machine: Flag.String("machine").pipe(Flag.withDescription("Another machine's outline host, through its ssh forward"), Flag.withSchema(MachineName), Flag.optional),
    json: Flag.Boolean("json").pipe(Flag.withDescription("Print the host's answer for agents"), Flag.withDefault(false)),
  }),
  Command.withDescription("The outline host's outlines, by name"),
);

const list = Command.make("list", {
  all: Flag.Boolean("all").pipe(Flag.withDescription("Every machine's outlines"), Flag.withDefault(false)),
}, Effect.fn(function*({ all }) {
  const root = yield* outline;
  if (all && Option.isSome(root.machine)) return yield* Console.error("ep0ch: outline list --all lists every machine already; leave out --machine");
  const r = yield* hostRequest(yield* HostSocket, "outlines.list", {}, { result: HostedOutlineList });
  if (root.json) return yield* Console.log(JSON.stringify(r, null, 2));
  for (const o of r.outlines) yield* Console.log(`${o.name}${o.open ? " (open)" : ""}${o.default ? " (default)" : ""}  ${o.database}`);
})).pipe(Command.withDescription("List the outlines"), Command.withAlias("ls"));

const create = Command.make("create", {
  name: Argument.String("name").pipe(Argument.withDescription("The outline's name"), Argument.withSchema(OutlineName)),
}, Effect.fn(function*({ name }) {
  const root = yield* outline;
  const r = yield* hostRequest(yield* HostSocket, "outlines.create", { name }, { result: HostedOutline });
  yield* Console.log(root.json ? JSON.stringify(r) : `created ${r.name} at ${r.database}`);
})).pipe(Command.withDescription("Make an outline on this machine"), Command.withExamples([{ command: "ep0ch outline create jam-shelf", description: "A new outline named jam-shelf" }]));

const del = Command.make("delete", {
  name: Argument.String("name").pipe(Argument.withSchema(OutlineName)),
  yes: Flag.Boolean("yes").pipe(Flag.withDescription("Don't ask"), Flag.withDefault(false)),
}, Effect.fn(function*({ name, yes }) {
  if (!yes) return yield* Console.error(`ep0ch: outline delete ${name} moves its files aside; add --yes to do it`);
  const r = yield* hostRequest(yield* HostSocket, "outlines.delete", { name }, { result: Schema.Struct({ name: Schema.String, movedTo: Schema.String }) });
  yield* Console.log(`${r.name} moved to ${r.movedTo}`);
})).pipe(Command.withDescription("Move an outline's files aside (nothing is erased)"));

export const outlineCommand = outline.pipe(Command.withSubcommands([list, create, del]));

/** Run with explicit words, as a test or main.ts would: `runOutline(["list", "--json"])`. */
export const runOutline = Command.runWith(outlineCommand, { version: "spike" });
