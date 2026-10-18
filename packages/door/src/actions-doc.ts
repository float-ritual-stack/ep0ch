// `ep0ch actions --doc <name>` (PIE-1032): an action's page, drawn in the terminal as the power bar's preview draws it
// (the readers' renderers over src/surface/action-page.ts), or its Blockdown (`--source`), or both as JSON (`--json`).
// The running door answers first, so an extension's action has its page too; with no door, the door's own actions are
// read from the registry in this process.
import { ask } from "./jsonl";
import type { ActionInfo } from "./surface/actions";

const USAGE = "ep0ch actions --doc <action> [--source] [--json] [--width <columns>]   for example: ep0ch actions --doc layout.move";

/** The actions a running door lists, or null when none answered. */
async function doorActions(): Promise<ActionInfo[] | null> {
  try {
    let path = process.env.EP0CH_CONTROL;
    if (!path) {
      const { controlFor } = await import("./session/place");
      const at = await controlFor(process.env, process.cwd());
      if (typeof at !== "string") return null;
      path = at;
    }
    const r = await ask(path, { cmd: "actions" }, 3000);
    return r?.ok && Array.isArray(r.result?.actions) ? r.result.actions as ActionInfo[] : null;
  } catch { return null; }
}

/** Every built-in action, from the registry in this process: the screens' sets and the tile kinds'. */
async function registryActions(): Promise<ActionInfo[]> {
  await import("./app");
  await import("./screens");
  const { allActionSets } = await import("./surface/actions");
  const seen = new Set<string>();
  return allActionSets().flatMap(s => s.list()).filter(a => (seen.has(a.name) ? false : (seen.add(a.name), true)));
}

export async function actionsDoc(args: readonly string[]): Promise<number> {
  const at = args.indexOf("--doc"), name = args[at + 1];
  if (at < 0 || !name || name.startsWith("--")) { console.error(`which action? ${USAGE}`); return 2; }
  const wi = args.indexOf("--width"), width = wi >= 0 ? Number(args[wi + 1]) : process.stdout.columns || 80;
  if (!Number.isFinite(width) || width < 20) { console.error(`--width is a number of columns, 20 or more: ${USAGE}`); return 2; }
  const fromDoor = await doorActions();
  let info = fromDoor?.find(a => a.name === name);
  const all = info ? [] : await registryActions();
  info ??= all.find(a => a.name === name);
  if (!info) {
    const near = [...(fromDoor ?? []), ...all].map(a => a.name).filter((n, i, xs) => xs.indexOf(n) === i && (n.includes(name) || name.includes(n.split(".").pop()!)));
    console.error(`no action ${name}${near.length ? `; did you mean ${near.slice(0, 6).join(", ")}?` : ""} · \`ep0ch actions\` lists the ones on the door's screen`);
    return 1;
  }
  const { actionPage } = await import("./surface/action-page");
  const page = actionPage(info);
  if (args.includes("--json")) { console.log(JSON.stringify({ name: info.name, page })); return 0; }
  if (args.includes("--source")) { console.log(page); return 0; }
  const { draftPreview } = await import("./surface/note");
  const drawn = draftPreview(page, Math.min(width, 120), null).join("\n");
  // Piped (an agent reading it), the words without the colours.
  console.log(process.stdout.isTTY ? drawn : drawn.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, ""));
  return 0;
}
