import { spawn } from "node:child_process";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, ProcessTerminal } from "@earendil-works/pi-tui";
import { decodePiDetailInput } from "./detail-pi-input";
import { relaunchArgs, relaunchEnvironment } from "./herdr-open-relaunch";
import { createHostedOutline, importHostedOutline, listHostedOutlines, outlineHostClient } from "./outline-host-client";
import {
  chooserKey,
  chooserMouse,
  OutlineChooser,
  parseOutlineChooserContext,
  planChoice,
  renderChooserFrame,
  type ChooserIntent,
} from "./outline-chooser";
import { reportCurrentPaneWorkspace } from "./pane-control";
import { clientSocket, machineFor, writeDotEp0ch } from "./paths";
import { isTreeMouseSequence } from "./tree-mouse";

if (process.env.HERDR_ENV !== "1") throw new Error("The outline chooser requires Herdr");
const context = parseOutlineChooserContext(process.env.OUTLINER_CHOOSER_CONTEXT);
reportCurrentPaneWorkspace(context.workspaceRoot);
const chooser = new OutlineChooser(context);
const terminal = new ProcessTerminal();
let stopping = false;
let workQueue = Promise.resolve();

function draw(): void {
  if (stopping) return;
  terminal.write("\x1b[H\x1b[2J" + renderChooserFrame(chooser, terminal.columns, terminal.rows).join("\r\n"));
}

async function stop(exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  await terminal.drainInput();
  terminal.stop();
  terminal.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l");
  process.exit(exitCode);
}

async function choose(): Promise<void> {
  const row = chooser.selected;
  if (!row || chooser.busy) return;
  const plan = planChoice(chooser, row);
  if (plan.kind === "refuse") { chooser.status = plan.message; draw(); return; }
  if (plan.kind === "input") { chooser.input = plan.input; chooser.status = ""; draw(); return; }
  chooser.busy = true;
  try {
    const host = await outlineHostClient();
    if (!host) throw new Error(`The outline host at ${clientSocket().socket} stopped answering; nothing was created`);
    if (plan.kind === "create") {
      chooser.status = `Creating outline ${plan.name}…`;
      draw();
      await createHostedOutline(host, plan.name);
    } else if (plan.kind === "import") {
      chooser.status = `Importing ${plan.path} as ${plan.name}…`;
      draw();
      await importHostedOutline(host, plan.path, plan.name);
    }
    // The folder names its outline from now on; the switcher replaces what it named.
    // On another machine's host (EP0CH_MACHINE, the folder's .ep0ch), the machine is written beside the name.
    const machine = clientSocket(process.env, machineFor()).machine;
    if (plan.dotFolder) writeDotEp0ch(plan.dotFolder, plan.name, { replace: context.switch === true, ...(machine ? { machine } : {}) });
  } catch (error) {
    chooser.busy = false;
    chooser.status = error instanceof Error ? error.message : String(error);
    draw();
    return;
  }
  // The popup closes before the panes open; the launcher reports its own failures.
  const relaunch = relaunchEnvironment(process.env, context.workspaceRoot, context.paneId);
  // The chosen outline opens whatever else the environment says (a folder too broad to name has no .ep0ch).
  relaunch.EP0CH_WS = plan.name;
  spawn(process.execPath, relaunchArgs(context.mode, context.clientId), {
    env: relaunch,
    detached: true,
    stdio: "ignore",
  }).unref();
  await stop();
}

/** Waits for an in-progress choice so a created outline always gets its `.ep0ch`. */
function queueStop(exitCode = 0): void {
  workQueue = workQueue.then(() => stop(exitCode), () => stop(exitCode));
}

function apply(intent: ChooserIntent): void {
  if (intent === "close") queueStop();
  else if (intent === "choose") workQueue = workQueue.then(choose).catch(error => {
    chooser.busy = false;
    chooser.status = error instanceof Error ? error.message : String(error);
    draw();
  });
  else if (intent === "changed") draw();
}

initTheme(undefined, false);
terminal.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h");
terminal.start(data => {
  try {
    if (isKeyRelease(data)) return;
    if (isTreeMouseSequence(data)) {
      apply(chooserMouse(chooser, data, terminal.columns, terminal.rows));
      return;
    }
    const input = decodePiDetailInput(data);
    if (input.kind === "paste") {
      // A pasted path goes into the line being typed.
      if (chooser.input && !chooser.busy) { chooser.input.text += input.text.replace(/[\r\n]+/g, ""); draw(); }
      return;
    }
    if (input.inputAction === "suppress") return;
    apply(chooserKey(chooser, input.key));
  } catch (error) {
    // Never leave the popup's terminal in the alternate screen with mouse reporting on.
    console.error(error);
    void stop(1);
  }
}, draw);
process.on("SIGINT", () => queueStop(130));
process.on("SIGTERM", () => void stop(143));
process.on("SIGHUP", () => void stop(129));
draw();
void (async () => {
  const host = await outlineHostClient();
  if (!host) throw new Error(`No outline host answers at ${clientSocket().socket}; start it, then open the Outliner again`);
  chooser.setHostedOutlines((await listHostedOutlines(host)).outlines);
})()
  .then(() => draw())
  .catch(error => {
    chooser.loading = false;
    chooser.status = `Could not list outlines: ${error instanceof Error ? error.message : String(error)}`;
    draw();
  });
