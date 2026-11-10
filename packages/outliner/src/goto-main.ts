import { isKeyRelease, ProcessTerminal } from "@earendil-works/pi-tui";
import { decodePiDetailInput } from "./detail-pi-input";
import { GotoController } from "./goto-controller";
import { handleGotoMouse, renderGotoFrame } from "./goto-renderer";
import { createHerdrSession, requireHerdr, startHerdrClient } from "./herdr-session";
import { isTreeMouseSequence } from "./tree-mouse";

requireHerdr("Goto popup");
const sourceClientId = process.env.OUTLINER_GOTO_SOURCE_CLIENT_ID?.trim();
if (!sourceClientId) throw new Error("OUTLINER_GOTO_SOURCE_CLIENT_ID is required");
const sourceRegion = process.env.OUTLINER_GOTO_SOURCE_REGION;
if (sourceRegion !== "tree" && sourceRegion !== "detail") throw new Error("OUTLINER_GOTO_SOURCE_REGION must be tree or detail");

const { client, keymap } = await startHerdrClient({ compatible: true });
const terminal = new ProcessTerminal();

// The popup is a transient reader, not another registered Tree or Detail.
const controller = new GotoController({
  request: input => client.request(input),
  invalidate: draw,
  close: () => stop(),
  async open(blockId, destination) {
    if (destination === "tree") {
      await client.request({ action: "ui.command.send", command: {
        targetClientId: sourceClientId, targetRegion: "tree", command: "focus",
        target: { kind: "block", blockId },
      } });
    } else {
      await client.request({ action: "navigation.dispatch", sourceClientId, sourceRegion,
        target: { kind: "block", blockId }, intent: "open" });
    }
    await stop();
  },
});

function draw(): void {
  if (session.stopping) return;
  terminal.write("\x1b[H\x1b[2J" + renderGotoFrame(controller, terminal.columns, terminal.rows,
    keymap.helpText("tree", "goto")).join("\r\n"));
}

const stop = (exitCode = 0) => session.stop(exitCode);
const session = createHerdrSession({
  modes: { mouse: "click" },
  draw,
  onError(error) {
    controller.status = error instanceof Error ? error.message : String(error);
    draw();
  },
  leave: () => controller.dispose(),
  input: { kind: "pi", terminal, onData(data) {
    if (isKeyRelease(data)) return;
    if (isTreeMouseSequence(data)) {
      session.enqueue(() => handleGotoMouse(controller, data, terminal.columns, terminal.rows));
      return;
    }
    // ProcessTerminal already assembles complete keys and bracketed pastes.
    const input = decodePiDetailInput(data);
    if (input.kind === "paste") { session.enqueue(() => controller.paste(input.text)); return; }
    if (input.inputAction === "suppress") return;
    const mapped = keymap.canonicalize("tree", "goto", input.str, input.key);
    if (mapped.suppressed) return;
    session.enqueue(() => mapped.actionId === "tree.close" || (mapped.key.ctrl && mapped.key.name === "c")
      ? controller.cancel()
      : controller.input(mapped.str, mapped.key));
  } },
});
// Keyboard protocol state belongs to the active screen buffer: the session enters it first.
session.start();
controller.start();
