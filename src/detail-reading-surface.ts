import type { PreviewRegionAction } from "./detail-preview-regions";
import type { DetailController, DetailOpenRouting, DetailViewport } from "./detail-controller";
import type { OutlinerEvent, OutlinerNavigationTarget, OutlinerUiCommand } from "./types";

/** One retained reader and one disposable, read-only inspection surface. */
export class DetailReadingSurface {
  previewVisible = false;
  focused: "current" | "preview" = "current";

  constructor(
    readonly current: DetailController,
    readonly preview: DetailController,
    private readonly invalidate: () => void,
    private readonly releasePreview: () => Promise<void>,
    private readonly currentProtected: () => boolean = () => false,
  ) {}

  get active(): DetailController {
    return this.previewVisible && this.focused === "preview" ? this.preview : this.current;
  }

  toggleFocus(): void {
    if (!this.previewVisible) {
      this.current.onServiceError(new Error("Select an item to inspect in Preview"));
      return;
    }
    this.focused = this.focused === "current" ? "preview" : "current";
    this.invalidate();
  }

  async closePreview(): Promise<void> {
    this.previewVisible = false;
    this.preview.releaseDocument();
    this.focused = "current";
    await this.releasePreview();
    this.invalidate();
  }

  async receive(command: OutlinerUiCommand, viewport: DetailViewport): Promise<void> {
    if (command.command === "preview") {
      this.previewVisible = true;
      if (!this.current.state.target) this.focused = "preview";
      await this.preview.handleUiCommand(command, viewport);
    } else {
      this.focused = "current";
      await this.current.handleUiCommand(command, viewport);
    }
    this.invalidate();
  }

  async onServiceEvent(event: OutlinerEvent, viewport: DetailViewport): Promise<void> {
    if (event.domain === "ui" && event.command) return this.receive(event.command, viewport);
    await this.current.onServiceEvent(event, viewport);
    if (this.previewVisible && event.domain !== "attention") await this.preview.onServiceEvent(event, viewport);
  }

  async activatePreviewAction(action: PreviewRegionAction, viewport: DetailViewport, routing?: DetailOpenRouting): Promise<void> {
    if (this.active === this.preview && (action.type === "annotation.thread.reply" || action.type === "annotation.thread.lifecycle")) {
      if (!await this.keepPreview(viewport)) return;
    }
    await this.active.dispatch({type: "preview.action", action, ...(routing ? {routing} : {})}, viewport);
  }

  async keepPreview(viewport: DetailViewport): Promise<boolean> {
    const target: OutlinerNavigationTarget | null = this.preview.state.target;
    if (!this.previewVisible || !target) return false;
    return this.openHere(target, viewport);
  }

  async openHere(target: OutlinerNavigationTarget, viewport: DetailViewport): Promise<boolean> {
    if (this.currentProtected() || this.current.isBufferMode() || this.current.state.selectionAnchor !== null) {
      this.preview.onServiceError(new Error("Finish or cancel the Current draft or source selection before keeping Preview"));
      return false;
    }
    await this.current.handleUiCommand({command: "replace", targetClientId: "local-current", target}, viewport);
    if (JSON.stringify(this.current.state.target) !== JSON.stringify(target)) return false;
    await this.closePreview();
    return true;
  }
}
