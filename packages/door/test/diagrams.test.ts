// Pictures from a note's fences (PIE-1555): a ```mermaid and a ```svg fence draw as images through the media pipeline,
// sized to the body; a text reader is told what they are; a fence that can't draw shows its source with why; and with
// graphics off (ep0ch show, a terminal without kitty) they stay text. Made-up diagrams.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describeMermaid, describeSvg, FENCE_PICTURES, fencePicture as picture, flattenSvgVars, forgetFencePictures, pictureColours, pictureLinkTarget, pictureRoom, svgLinkBoxes } from "../src/diagrams";

/** The picture a 44-column reader asks for. */
const fencePicture = (lang: string, src: string, cols = 44) => picture(lang, src, pictureRoom(cols, 9, 18));
import { linkCells, renderDoc, type DocEnv } from "../src/doc";
import { media } from "../src/media";
import { visible } from "../src/style";
import { until } from "./scratch";

const FLOW = "flowchart LR\n  A[Sow] --> B{Frost?}\n  B -->|yes| C[Cover the bed]\n  B -->|no| D[Water]\n  C --> E[Harvest]\n  D --> E";
const SEQ = "sequenceDiagram\n  participant Gardener\n  Gardener->>Shed: fetch the fork\n  Shed-->>Gardener: the fork";
const STATE = "stateDiagram-v2\n  [*] --> Seed\n  Seed --> Sprout: water\n  Sprout --> Plant\n  Plant --> [*]";
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#123"/><circle cx="50" cy="50" r="30" fill="#4fb3c7"/></svg>`;

let dir = "";
const saved = process.env.EP0CH_STATE;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "ep0ch-diagrams-")); process.env.EP0CH_STATE = join(dir, "state"); forgetFencePictures(); });
afterAll(() => { if (saved === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = saved; rmSync(dir, { recursive: true, force: true }); });

const env = (over: Partial<DocEnv> = {}): DocEnv => ({ width: 44, cellW: 9, cellH: 18, graphics: true, maxImageRows: 30, unfold: true, pictureSource: "~ shows its source", ...over });
const fence = (lang: string, body: string) => `Plot notes\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\nafter the fence`;

describe("what a fence's picture is, in words", () => {
  test("mermaid: its kind and how many things it has", () => {
    expect(describeMermaid(FLOW)).toBe("mermaid diagram: flowchart, 5 nodes");
    expect(describeMermaid(SEQ)).toBe("mermaid diagram: sequence, 2 participants");
    expect(describeMermaid(STATE)).toBe("mermaid diagram: state, 3 states");
    expect(describeMermaid("pie title Beds\n  \"beans\": 3")).toBe("mermaid diagram");
  });
  test("svg: its size", () => expect(describeSvg(SVG)).toBe("svg picture: 200×100"));
});

describe("the SVG librsvg is given", () => {
  test("every CSS variable and color-mix is written in as a colour", () => {
    const out = flattenSvgVars(`<svg style="--a:#ff0000;--b:var(--a);--c:color-mix(in srgb, var(--a) 50%, #000000)"><rect fill="var(--b)" stroke="var(--c)"/><rect fill="var(--nope, #00ff00)"/></svg>`);
    expect(out).toContain('fill="#ff0000"');
    expect(out).toContain('stroke="#800000"');
    expect(out).toContain('fill="#00ff00"');
  });

  test("mermaid flowchart, sequence and state diagrams render in the door's colours, legibly", async () => {
    for (const src of [FLOW, SEQ, STATE]) {
      const svg = await FENCE_PICTURES.mermaid!.svg(src, pictureColours(), pictureRoom(80, 9, 18));
      expect(svg).not.toMatch(/var\(--|color-mix/);
      const { data, info } = await sharp(Buffer.from(svg)).flatten({ background: "#000" }).raw().toBuffer({ resolveWithObject: true });
      // Not one flat colour (fills gone black is what an unflattened SVG gives): text and lines show over the ground.
      const shades = new Set<number>();
      for (let i = 0; i < data.length; i += info.channels * 97) shades.add(data[i]! + data[i + 1]! * 256);
      expect(shades.size).toBeGreaterThan(4);
      // Dark first: never a white sheet.
      let sum = 0; for (let i = 0; i < data.length; i += info.channels) sum += data[i]!;
      expect(sum / (data.length / info.channels)).toBeLessThan(90);
    }
  });
});

describe("a picture fence in a note", () => {
  /** The note drawn `cols` wide once its picture is made and read. */
  const drawnAt = async (cols: number) => {
    renderDoc(fence("mermaid", FLOW), env({ width: cols }));
    await until(() => fencePicture("mermaid", FLOW, cols)?.state === "ready", `the flowchart's SVG at ${cols}`);
    const path = (fencePicture("mermaid", FLOW, cols) as { path: string }).path;
    await until(() => media(path, "img").state === "ready", "the flowchart read as an image");
    return renderDoc(fence("mermaid", FLOW), env({ width: cols }));
  };

  test("with graphics: drawing, then a picture laid out for the body with its caption; the fence's text isn't drawn", async () => {
    const first = renderDoc(fence("mermaid", FLOW), env()).lines.map(visible);
    expect(first.some(l => l.includes("◌ mermaid diagram: flowchart, 5 nodes"))).toBe(true);
    const doc = await drawnAt(44), text = doc.lines.map(visible);
    expect(doc.images).toHaveLength(1);
    expect(doc.images[0]!.col).toBe(0);
    expect(doc.images[0]!.cols).toBeLessThanOrEqual(44);
    expect(doc.images[0]!.cols).toBeGreaterThan(20);
    expect(text.some(l => l.includes("▣ mermaid diagram: flowchart, 5 nodes"))).toBe(true);
    expect(text.some(l => l.includes("Frost?"))).toBe(false);
    // At 160 columns it's laid out again for the wider body (left to right there, top to bottom at 44).
    const wide = await drawnAt(160);
    expect(wide.images[0]!.cols).toBeLessThanOrEqual(160);
    expect(wide.images[0]!.cols).toBeGreaterThan(doc.images[0]!.cols);
    expect(wide.images[0]!.media.path).not.toBe(doc.images[0]!.media.path);
    expect(wide.lines.map(visible).some(l => /▣ mermaid diagram: flowchart, 5 nodes · \d+ chars · ~ shows its source/.test(l))).toBe(true);
  });

  test("a ```svg fence draws as its picture too", async () => {
    renderDoc(fence("svg", SVG), env());
    await until(() => fencePicture("svg", SVG)?.state === "ready", "the svg fence's file");
    const path = (fencePicture("svg", SVG) as { path: string }).path;
    await until(() => media(path, "img").state === "ready", "the svg read as an image");
    const doc = renderDoc(fence("svg", SVG), env());
    expect(doc.images).toHaveLength(1);
    expect(doc.lines.map(visible).some(l => l.includes("▣ svg picture: 200×100"))).toBe(true);
  });

  test("one that can't draw shows its source, with why under it", async () => {
    const bad = "flowchart LR\n  A[open --> ";
    renderDoc(fence("mermaid", bad), env());
    await until(() => fencePicture("mermaid", bad)?.state !== "drawing", "the broken diagram's answer");
    const text = renderDoc(fence("mermaid", bad), env()).lines.map(visible);
    expect(text.some(l => l.includes("A[open -->"))).toBe(true);
    expect(text.some(l => l.includes("✗ mermaid didn't draw:"))).toBe(true);
  });

  test("without graphics, or as written (~), it stays text, its header saying what it would draw", () => {
    for (const e of [env({ graphics: false }), env({ pictures: false })]) {
      const doc = renderDoc(fence("mermaid", FLOW), e), text = doc.lines.map(visible);
      expect(doc.images).toHaveLength(0);
      expect(text.some(l => l.includes("╭ mermaid · mermaid diagram: flowchart, 5 nodes"))).toBe(true);
      expect(text.some(l => l.includes("Frost?"))).toBe(true);
    }
  });

  test("an [img::…svg] line is an image already", async () => {
    const asset = join(import.meta.dir, "../src/showcase/assets/plot-plan.svg");
    await until(() => media(asset, "img").state === "ready", "the svg file read as an image");
    const doc = renderDoc(`Plan\n\n[img::${asset}] [size::full]`, env());
    expect(doc.images).toHaveLength(1);
  });
});

describe("links laid out in an SVG", () => {
  const LINKED = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#123"/><g transform="translate(200,100)"><a href="[[Bike shed]]"><rect width="100" height="50" fill="#456"/></a></g><a href="#nowhere"><rect width="10" height="10"/></a></svg>`;

  test("each <a href> has the box it draws, transforms and all; its target is a page, a block or a web address", async () => {
    const [shed, frag] = await svgLinkBoxes(LINKED);
    expect(shed!.href).toBe("[[Bike shed]]");
    expect(shed!.box.x).toBeCloseTo(0.5, 1); expect(shed!.box.y).toBeCloseTo(0.5, 1);
    expect(shed!.box.w).toBeCloseTo(0.25, 1); expect(shed!.box.h).toBeCloseTo(0.25, 1);
    expect(frag!.href).toBe("#nowhere");
    expect(pictureLinkTarget("[[Bike shed]]", "x")).toEqual({ page: "Bike shed", label: "x" });
    expect(pictureLinkTarget("((abc123|the shed))", "x")).toEqual({ block: "abc123", label: "x" });
    expect(pictureLinkTarget("https://example.com/plot", "x")).toEqual({ url: "https://example.com/plot", label: "x" });
    expect(pictureLinkTarget("javascript:alert(1)", "x")).toBeNull();
  });

  test("its cells are one tagged press over the rows and columns it covers; a link to nowhere is left out", async () => {
    const links = await svgLinkBoxes(LINKED), lines = Array.from({ length: 10 }, () => ""), targets: unknown[] = [];
    linkCells(lines, 0, { col: 2, cols: 40, rows: 10 }, links, (to, text) => { targets.push(to); return `<${targets.length - 1}>${text}`; });
    expect(targets).toEqual([{ page: "Bike shed", label: "Bike shed" }]);
    const rows = lines.flatMap((l, r) => (l ? [r] : []));
    expect(rows).toEqual([5, 6, 7]);
    expect(visible(lines[5]!).indexOf("<")).toBe(22);
  });
});
