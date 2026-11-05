/**
 * The flags `ext add`, `ext remove` and `ext update` take: one table that the parser, the usage line and the door's
 * help and completion all read, so what help lists is what the command takes (PIE-1548). No file or service imports:
 * the door's `cli-commands.ts` reads it for completion.
 */
export interface ExtFlag {
  name: string;
  /** The value it takes, as help writes it; none is a switch. */
  value?: string;
  does: string;
}

const outlineFolder: ExtFlag = { name: "outline-folder", value: "<outline root>", does: "Only this outline's own extensions folder (the outlines folder's <name>/)" };
const userFolder: ExtFlag = { name: "user-folder", does: "Only the machine's folder, which every outline this host serves reads" };

export type ExtVerb = "add" | "remove" | "update";

export const EXT_FLAGS: Record<ExtVerb, readonly ExtFlag[]> = {
  add: [
    { name: "outline-folder", value: "<outline root>", does: "Install into this outline's own extensions folder instead of the machine's" },
    { name: "from", value: "<path>", does: "Copy from this folder" },
  ],
  remove: [
    outlineFolder, userFolder,
    { name: "demo", value: "keep|remove", does: "Its demo notes stay (keep, the default) or go to Trash, except what someone changed (remove)" },
  ],
  update: [
    { name: "all", does: "Every installed copy of a built-in, in the machine's folder and every outline's own" },
    outlineFolder, userFolder,
    { name: "yes", does: "Take the built-in's over a changed copy (your files are kept in extensions-forks/ first)" },
    { name: "keep-forked", does: "Leave a changed copy as it is and only list it" },
    { name: "json", does: "Print JSON" },
  ],
};

const flagWord = (flag: ExtFlag) => `--${flag.name}${flag.value ? ` ${flag.value}` : ""}`;

/** What `parseArgs` takes for this verb. */
export function extFlagOptions(verb: ExtVerb): Record<string, { type: "string" | "boolean" }> {
  return Object.fromEntries(EXT_FLAGS[verb].map((flag) => [flag.name, { type: flag.value ? "string" as const : "boolean" as const }]));
}

/** `[--a <b>] [--c]`: the flags as a usage line writes them. */
export const extFlagUsage = (verb: ExtVerb): string => EXT_FLAGS[verb].map((flag) => `[${flagWord(flag)}]`).join(" ");

/** Each flag and what it does, for a help table. */
export const extFlagRows = (verb: ExtVerb): readonly (readonly [string, string])[] => EXT_FLAGS[verb].map((flag) => [flagWord(flag), flag.does] as const);
