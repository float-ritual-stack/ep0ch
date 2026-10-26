// The media line's grammar is shared (PIE-598): the service's property parser and every client agree on it.
import { describe, expect, test } from "bun:test";
import { artifactKind, artifactTitle, HERO_PROP_NAMES, heroPropSet, heroPropStep, heroPropText, imagePrimitiveSpec, imageSource, isMediaLine, parseMediaLine, rewriteMediaLine } from "../src/media-line";

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
  expect(parseMediaLine("[artifact::notes.md]")!.problems).toEqual([]);
  expect(parseMediaLine("[artifact::moth-site@2]")!.problems).toEqual([]);
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

describe("a header image's look (PIE-1361): one description, read by the tune and image.look", () => {
  const spec = (s: string) => parseMediaLine(`[img::a.png] [layout::hero] ${s}`)!;
  test("each property as its line writes it, left out undefined", () => {
    const s = spec("[height::12] [hero-focus::0.25,0.6] [tint::0.5] [title::over]");
    expect(HERO_PROP_NAMES.map(p => [p, heroPropText(s, p)])).toEqual([
      ["height", "12"], ["focus.x", "0.25"], ["focus.y", "0.6"], ["fit", undefined], ["dim", undefined], ["tint", "0.5"],
      ["fade", undefined], ["blur", undefined], ["bleed", undefined], ["title", "over"], ["scroll", undefined],
    ]);
    expect(heroPropText(spec("[height::25%]"), "height")).toBe("25%");
  });
  test("set: the line's property, none takes it off, a focus half keeps the other; a bad value says what it can be", () => {
    const s = spec("[hero-focus::0.25,0.6]");
    expect(heroPropSet(s, "tint", "0.75")).toEqual({ set: { tint: "0.75" } });
    expect(heroPropSet(s, "fit", "none")).toEqual({ set: { fit: null } });
    expect(heroPropSet(s, "focus.y", "0.1")).toEqual({ set: { "hero-focus": "0.25,0.1" } });
    expect(heroPropSet(spec(""), "focus.x", "0.5")).toEqual({ set: { "hero-focus": null } });
    expect(heroPropSet(s, "blur", "99")).toEqual({ problem: expect.stringMatching(/^blur is soften it/) });
    expect(heroPropSet(s, "height", "80%")).toEqual({ problem: expect.stringContaining("at most half") });
    expect(rewriteMediaLine("[img::a.png] [layout::hero]", (heroPropSet(s, "title", "over") as any).set)).toBe("[img::a.png] [layout::hero] [title::over]");
  });
  test("a step goes through the values; from a value written by hand, to the nearest on its side", () => {
    expect(heroPropStep("tint", undefined, 1)).toBe("0.25");
    expect(heroPropStep("tint", "0.25", -1)).toBe("none");
    expect(heroPropStep("fit", undefined, 1)).toBe("contain");
    expect(heroPropStep("height", "12", 1)).toBe("14");
    expect(heroPropStep("height", "13", -1)).toBe("12");
    expect(heroPropStep("focus.x", undefined, -1)).toBe("0.4");
    expect(heroPropStep("blur", "3", 1)).toBe("4");
  });
});
