// The media line's grammar is shared (PIE-598): the service's property parser and every client agree on it.
import { expect, test } from "bun:test";
import { artifactKind, artifactTitle, imagePrimitiveSpec, imageSource, isMediaLine, parseMediaLine } from "../src/media-line";

test("a media line is an image or video reference and its layout, nothing else", () => {
  expect(isMediaLine("[img::/p/beds.jpg] [hero-focus::0.8,0.6] [alt::the beds]")).toBe(true);
  expect(isMediaLine("- img:: /p/beds.jpg [size::40%]")).toBe(true);
  expect(isMediaLine("[video::/p/clip.mp4] ^clip")).toBe(true);
  expect(isMediaLine("[img::/p/a.png] [type::note]")).toBe(false);
  expect(isMediaLine("look: [img::/p/a.png]")).toBe(false);
  expect(isMediaLine("[status::planned]")).toBe(false);
  expect(parseMediaLine("[img::/p/a.png] [hero-focus::80%,25%]")).toMatchObject({ kind: "img", focus: { x: 0.8, y: 0.25 } });
});

test("an artifact line (PIE-793): [artifact::path] or floatty's artifact:: path, sized like an image; an image's layout and a kind claude.ai doesn't run are said on it", () => {
  expect(parseMediaLine("[artifact::artifacts/pulse-pad.jsx] [height::24] [alt::Pulse pad]")).toEqual({ kind: "artifact", path: "artifacts/pulse-pad.jsx", height: 24, alt: "Pulse pad", problems: [] });
  expect(parseMediaLine("artifact:: ~/Downloads/orbit lamp.html [size::80%]")).toEqual({ kind: "artifact", path: "~/Downloads/orbit lamp.html", size: { percent: 80 }, problems: [] });
  expect(isMediaLine("[artifact::a.jsx] [type::note]")).toBe(false);
  expect(parseMediaLine("[artifact::a.jsx] [layout::hero]")!.problems).toEqual(["layout:: is an image's: an artifact takes size, height, align and alt"]);
  expect(parseMediaLine("[artifact::notes.md]")!.problems).toEqual(["notes.md isn't an artifact (.jsx, .tsx, .html, .svg or .mermaid)"]);
});

test("an artifact's kind and title: [alt::] first, then an HTML or SVG file's <title>, then its file's name", () => {
  expect(["a.jsx", "b.TSX", "c.htm", "d.svg", "e.mmd", "f.md"].map(artifactKind)).toEqual(["react", "react", "html", "svg", "mermaid", null]);
  expect(artifactTitle({ path: "x/orbit.html" }, "<html><head><title>Orbit &amp; lamp\n</title>")).toBe("Orbit & lamp");
  expect(artifactTitle({ path: "x/orbit.html", alt: "Lamp" }, "<title>Orbit</title>")).toBe("Lamp");
  expect(artifactTitle({ path: "x/pulse-pad.jsx" }, "<title>not this</title>")).toBe("pulse-pad.jsx");
  expect(artifactTitle({ path: "x/orbit.html" })).toBe("orbit.html");
});

test("an image primitive's file: ref is read as a Resource ref is: absolute, or it names nothing", () => {
  expect(imageSource("media/beds.png")).toBe("media/beds.png");
  expect(imageSource("file:/srv/garden/beds.png")).toBe("/srv/garden/beds.png");
  expect(imageSource("file:media/beds.png")).toBe("");
  expect(imageSource("file:/srv/garden/be\u0007ds.png")).toBe("");
});

test("an image primitive whose file: ref can't be read says so on its caption", () => {
  expect(imagePrimitiveSpec({ src: "file:media/beds.png" }).problems).toEqual(["file:media/beds.png isn't a file: ref this can read (file:/absolute/path)"]);
});
