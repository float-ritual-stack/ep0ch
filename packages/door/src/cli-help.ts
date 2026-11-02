import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_COMMANDS, DOOR_OPTIONS, HELP_FLAGS, commandNamed, type CliCommand, type CliFlag } from "./cli-commands";
import { pad, width } from "./style";
import { rowLines } from "./text";

const columns = () => process.stdout.columns || 80;

function table(rows: readonly (readonly [string, string])[]): string[] {
  const leftWidth = Math.max(...rows.map(r => width(r[0])));
  return rows.flatMap(([left, right]) => right.split("\n").flatMap(line => rowLines(line, columns() - leftWidth - 4, Infinity))
    .map((line, i) => `  ${pad(i ? "" : left, leftWidth)}  ${line}`));
}

function details(command: CliCommand): string {
  const name = command.reference ?? command.name;
  const source = readFileSync(join(import.meta.dir, "../docs/cli.md"), "utf8");
  return source.split(`\n## ${name}\n`)[1]!.split("\n## ")[0]!.trim();
}

export function renderHelp(path = "", more = false): string {
  if (!path) {
    const lines = ["ep0ch: a BBS door into an outline", "Usage: ep0ch [--ws <name>] [--machine <ssh-name>]", ""];
    const commands = CLI_COMMANDS.filter(c => more || !c.moreOnly);
    for (const group of new Set(commands.map(c => c.group))) {
      lines.push(`${group}:`);
      lines.push(...table(commands.filter(c => c.group === group).map(c => [`ep0ch ${c.overview ?? c.name}`, c.summary])));
    }
    lines.push("", "ep0ch help <command> for more; ep0ch help launch for opening flags.", "ep0ch help --more lists every command; help <command> --more reads its rules.");
    return lines.join("\n");
  }
  const [name, subcommand] = path.split(" ");
  const parent = commandNamed(name === "launch" ? "" : name!)!;
  const command = subcommand ? parent.children!.find(c => c.name === subcommand)! : parent;
  const lines = [`${path} — ${command.summary}`, "", ...rowLines(`Usage: ep0ch ${command.synopsis}`, columns(), Infinity, { hang: 7 })];
  if (command.children) {
    lines.push("", "Commands (help <command> <subcommand> explains each flag):",
      ...table(command.children.map(c => [c.name, `${c.summary}\n${c.flags.map(([flag]) => flag).join("  ")}`])));
  }
  if (command.note) lines.push("", ...rowLines(command.note, columns(), Infinity));
  lines.push("", "Flags:", ...flagTable(command.flags), "", "Examples:", ...command.examples.map(e => `  ${e}`));
  lines.push("", `More: ep0ch help ${path} --more`);
  if (command.guide) lines.push(`Guide: ${command.guide}`);
  if (more) lines.push("", details(subcommand ? parent : command));
  return lines.join("\n");
}

function flagTable(flags: readonly CliFlag[]): string[] {
  return table([["Flag", "What it does"], ...[...flags, ...HELP_FLAGS].map(([flag, description]): [string, string] => [flag, description])]);
}

/** Words through the cursor, including an empty last word after a space. */
function candidates(words: readonly string[]): string[] {
  const prefix = words.at(-1) ?? "", before = words.slice(0, -1);
  let command: CliCommand | undefined;
  for (let i = 0; i < before.length; i++) {
    const word = before[i]!;
    if (word === "--ws" || word === "--machine" || word === "--as") { i++; continue; }
    if (word === "help" && !command) continue;
    const next = command ? command.children?.find(c => c.name === word) : commandNamed(word);
    if (next) command = next;
  }
  const flags = [...(command?.flags ?? DOOR_OPTIONS), ...HELP_FLAGS].flatMap(([f]) => f.match(/--[a-z-]+|(?<=, )-[a-z]/g) ?? []);
  const names = command ? (command.children?.map(c => c.name) ?? []) : CLI_COMMANDS.map(c => c.name).filter(Boolean);
  return [...new Set([...names, ...flags])].filter(w => w.startsWith(prefix));
}

export function completionCommand(args: readonly string[]): number {
  if (args[0] === "--") { console.log(candidates(args.slice(1)).join("\n")); return 0; }
  const scripts: Record<string, string> = {
    bash: `_ep0ch_complete() {
  local word
  COMPREPLY=()
  while IFS= read -r word; do
    [[ -n "$word" ]] && COMPREPLY+=("$word")
  done < <(ep0ch completions -- "\${COMP_WORDS[@]:1:COMP_CWORD}")
}
complete -F _ep0ch_complete ep0ch`,
    zsh: `#compdef ep0ch
_ep0ch() {
  local -a replies
  replies=("\${(@f)$(ep0ch completions -- "\${words[@]:1:$((CURRENT-1))}")}")
  compadd -- "\${replies[@]}"
}
compdef _ep0ch ep0ch`,
    fish: `complete -c ep0ch -f -a '(ep0ch completions -- (commandline -opc)[2..-1] (commandline -ct))'`,
  };
  if (args.length !== 1 || !scripts[args[0]!]) {
    console.error("ep0ch: choose a shell: ep0ch completions bash|zsh|fish · source the printed script");
    return 2;
  }
  console.log(scripts[args[0]!]!);
  return 0;
}
