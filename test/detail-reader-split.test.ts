import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { expect, test } from "bun:test";
import { DetailReaderSplitLayout } from "../src/detail-pi-renderer";

test("switching Current components and resizing invalidates only the displayed readers", () => {
  function pane(label: string) {
    let cachedText: string | undefined;
    return {
      version: 0,
      invalidations: 0,
      render(width: number): string[] {
        cachedText ??= `${label}${this.version}`;
        return [cachedText.padEnd(width)];
      },
      invalidate(): void {
        this.invalidations++;
        cachedText = undefined;
      },
    };
  }
  const current = pane("Current");
  const editor = pane("Editor");
  const preview = pane("Preview");
  const split = new DetailReaderSplitLayout(current, preview);
  current.render(30);
  editor.render(30);
  preview.render(30);

  for (let turn = 1; turn <= 12; turn++) {
    const active = turn % 2 ? editor : current;
    const inactive = active === current ? editor : current;
    for (const width of [150, 201, 160]) {
      active.version++;
      preview.version++;
      const activeInvalidations = active.invalidations;
      const inactiveInvalidations = inactive.invalidations;
      const previewInvalidations = preview.invalidations;
      split.setLayout(active, width);
      split.invalidate();
      const lines = split.render(width).map(stripTerminalSequences);
      const leftWidth = Math.floor((width - 1) / 2);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.slice(0, leftWidth).trim()).toBe(`${active === current ? "Current" : "Editor"}${active.version}`);
      expect(lines[0]!.slice(leftWidth + 1).trim()).toBe(`Preview${preview.version}`);
      expect(visibleWidth(lines[0]!)).toBe(width);
      expect(active.invalidations).toBe(activeInvalidations + 1);
      expect(preview.invalidations).toBe(previewInvalidations + 1);
      expect(inactive.invalidations).toBe(inactiveInvalidations);
    }
  }
});
