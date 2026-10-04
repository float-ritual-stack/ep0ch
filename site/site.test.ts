import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calloutMismatches, editedText, samples, sampleText, serveSite, siteFile, spanTexts } from "./lib";
import { ansiToHtml } from "./still";

const SITE = import.meta.dir;

describe("the check's server", () => {
  test("serves a page, and nothing outside site/: plain, encoded or double-encoded ../", async () => {
    const server = serveSite(SITE);
    try {
      const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`).then(r => r.status);
      expect(await get("/kitchen-sink.html")).toBe(200);
      expect(await get("/bare/kitchen-sink.html")).toBe(200);
      for (const path of ["/%2e%2e/bun.lock", "/..%2fbun.lock", "/%2e%2e%2fbun.lock", "/%252e%252e/bun.lock",
        "/%252e%252e%252fbun.lock", "/bare/..%2f..%2fbun.lock", "/..%2f..%2f..%2f..%2fetc%2fhostname"])
        expect([path, await get(path)]).toEqual([path, 404]);
    } finally { server.stop(true); }
  });

  test("never follows a symlink out of site/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-site-"));
    try {
      mkdirSync(join(dir, "site")); writeFileSync(join(dir, "secret.txt"), "no"); writeFileSync(join(dir, "site/page.html"), "yes");
      symlinkSync(join(dir, "secret.txt"), join(dir, "site/link.txt"));
      symlinkSync(dir, join(dir, "site/up"));
      const server = serveSite(join(dir, "site"));
      try {
        const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`).then(r => r.status);
        expect(await get("/page.html")).toBe(200);
        expect(await get("/link.txt")).toBe(404);
        expect(await get("/up/secret.txt")).toBe(404);
      } finally { server.stop(true); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("listens on loopback only", () => {
    const server = serveSite(SITE);
    try { expect(server.hostname).toBe("127.0.0.1"); } finally { server.stop(true); }
  });

  test("a path resolves inside the root or not at all", () => {
    expect(siteFile(SITE, "/kitchen-sink.html")).toBe(join(SITE, "kitchen-sink.html"));
    expect(siteFile(SITE, "/node_modules/@ep0ch/door/src/main.ts")).toBeNull();
    expect(siteFile("/r/site", "/../bun.lock")).toBeNull();
    expect(siteFile("/r/site", "/..%2f..%2fetc/passwd")).toBeNull();
    expect(siteFile("/r/site", "/%2e%2e/site-other/x")).toBeNull();
    expect(siteFile("/r/site", "/%E0%A4%A")).toBeNull();
    expect(siteFile("/r/site", "/a%00.html")).toBeNull();
  });
});

describe("samples", () => {
  test("every data-run is read, whatever its classes; a mark the check can't read is a problem", () => {
    const html = `<div class="code wide" data-run="sh" data-expect="hi"><div class="code-head">x</div><pre><code>echo hi</code></pre></div>
<pre data-run="edit" class="diff tight"><code><span class="del">a</span><span class="add">b</span></code></pre>
<p data-run="sh">nope</p>`;
    const { samples: found, problems } = samples(html);
    expect(found.map(s => s.kind)).toEqual(["sh", "edit"]);
    expect(sampleText(found[0]!)).toBe("echo hi");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("<p>");
  });

  test("an added line keeps the text inside its highlight spans", () => {
    const inner = `<span class="del">old <span class="hl">one</span></span><span class="add">new <span class="hl">two</span> &amp; more</span><span class="add">second</span>`;
    expect(spanTexts(inner, "add")).toEqual(["new two & more", "second"]);
    expect(spanTexts(inner, "del")).toEqual(["old one"]);
    expect(spanTexts(`<span class="del wide">x</span><span class="added">no</span><span class="add hl">y</span>`, "add")).toEqual(["y"]);
    expect(spanTexts(`<span class="del wide">x</span>`, "del")).toEqual(["x"]);
  });

  test("a diff with no removed line keeps the note's first line", () => {
    expect(editedText(["added"], 0, "title\nbody")).toBe("added\ntitle\nbody");
    expect(editedText(["new title"], 1, "title\nbody")).toBe("new title\nbody");
  });
});

describe("callouts", () => {
  test("a site callout is the door's built-in type: its icon and tone", () => {
    const one = (tone: string, icon: string, type: string) =>
      `<div class="callout" data-tone="${tone}"><div class="c-title"><span aria-hidden="true">${icon}</span> T<span class="type">${type}</span></div></div>`;
    expect(calloutMismatches(one("amber", "⚠", "warning") + one("violet", "?", "faq"))).toEqual([]);
    expect(calloutMismatches(one("green", "⚠", "warning"))[0]).toContain("⚠ amber in the door");
    expect(calloutMismatches(one("blue", "✎", "nonesuch"))[0]).toContain("isn't a built-in");
    expect(calloutMismatches(`<div class="callout" data-tone="blue"><p>no title</p></div>`)[0]).toContain("1 callouts, 0 read");
  });

  test("every page's callouts match the door's", async () => {
    for (const page of ["kitchen-sink.html", "showcase/callouts.html", "build/callout-type.html"])
      expect(calloutMismatches(await Bun.file(join(SITE, page)).text())).toEqual([]);
  });
});

describe("stills", () => {
  test("38;5;n and 48;5;n are one colour each, not three codes", () => {
    // ANSI 3 (yellow/brown) is the palette's 6: the palette is in VGA order.
    expect(ansiToHtml("\x1b[38;5;3mA\x1b[0m")).toBe(`<span style="color:var(--term-6)">A</span>`);
    expect(ansiToHtml("\x1b[91mR")).toBe(`<span style="color:var(--term-12)">R</span>`);
    expect(ansiToHtml("\x1b[48;5;196mB\x1b[0m")).toBe(`<span style="background:rgb(255 0 0)">B</span>`);
    expect(ansiToHtml("\x1b[38;5;240;1mC")).toBe(`<span style="color:rgb(88 88 88);font-weight:700">C</span>`);
  });

  test("a painted line keeps its trailing spaces; a plain one loses them", () => {
    expect(ansiToHtml("\x1b[44mbar   \n\x1b[0mtext   \nmore")).toBe(`<span style="background:var(--term-1)">bar   \n</span>text\nmore`);
    expect(ansiToHtml("\x1b[7msel  \n")).toBe(`<span style="color:var(--surface-ground);background:var(--ink-body)">sel  \n</span>`);
  });

  test("an OSC 8 link keeps its text", () => {
    expect(ansiToHtml("see \x1b]8;;https://example.com\x1b\\the docs\x1b]8;;\x1b\\ now")).toBe("see the docs now");
    expect(ansiToHtml("\x1b]8;;https://x\x07here\x1b]8;;\x07")).toBe("here");
  });
});
