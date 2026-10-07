// The media line's grammar is shared (PIE-598): the service's property parser and every client agree on it.
import { expect, test } from "bun:test";
import { isMediaLine, parseMediaLine } from "../src/media-line";

test("a media line is an image or video reference and its layout, nothing else", () => {
  expect(isMediaLine("[img::/p/beds.jpg] [hero-focus::0.8,0.6] [alt::the beds]")).toBe(true);
  expect(isMediaLine("- img:: /p/beds.jpg [size::40%]")).toBe(true);
  expect(isMediaLine("[video::/p/clip.mp4] ^clip")).toBe(true);
  expect(isMediaLine("[img::/p/a.png] [type::note]")).toBe(false);
  expect(isMediaLine("look: [img::/p/a.png]")).toBe(false);
  expect(isMediaLine("[status::planned]")).toBe(false);
  expect(parseMediaLine("[img::/p/a.png] [hero-focus::80%,25%]")).toMatchObject({ kind: "img", focus: { x: 0.8, y: 0.25 } });
});
