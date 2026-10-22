import { artifactResponse } from "../src/artifact-server";
import { ArtifactStore } from "../src/artifact-store";
import type { ArtifactInfo } from "@ep0ch/outline-core/artifacts";
import { afterAll, afterEach, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { OutlinerClient } from "../src/client";
import { scratchOutline } from "./scratch-outline";
import { Publisher } from "../src/publish";
import { ArtifactCompiler, artifactPackageFor, inlineScript, MERMAID_MODULE, TAILWIND_PLAY_CDN } from "../src/publish-artifacts";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

// Artifacts as claude.ai downloads them, attached to published blocks. Every
// test uses a throwaway service; the package cache is shared by this file so
// the pinned packages are fetched once.

const packageCache = mkdtempSync(join(tmpdir(), "outliner-artifact-cache-"));
afterAll(() => rmSync(packageCache, { recursive: true, force: true }));

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const COMPILE_TIMEOUT = 180_000;
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads";

async function setup(options: { artifactCacheDirectory?: string | null; roots?: string[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "outliner-publish-artifacts-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "garden");
  mkdirSync(workspace);
  const paths = scratchOutline(root, { folder: workspace });
  const store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const client = new OutlinerClient(paths.socket);
  const cache = options.artifactCacheDirectory === undefined ? packageCache : options.artifactCacheDirectory;
  const publisher = new Publisher({ client, roots: options.roots, ...(cache ? { artifactCacheDirectory: cache } : {}) });
  cleanups.push(async () => {
    await publisher.stop();
    await server.close();
    store.close();
  });
  await publisher.start();
  const get = (path: string) => publisher.handle(new Request(`http://127.0.0.1${path}`));
  const write = (relative: string, text: string) => {
    const file = join(workspace, relative);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
    return file;
  };
  return { root, workspace, store, client, get, write, socket: paths.socket };
}

const HTML_WITH_CDN = `<!doctype html>
<html><head><title>Moth phases</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"></script></head>
<body><ul id="phases"></ul>
<script>_.forEach(["egg", "caterpillar", "pupa", "moth"], (phase) => {
  const li = document.createElement("li"); li.textContent = phase; document.getElementById("phases").appendChild(li);
});</script></body></html>
`;

const REACT_COUNTER = `import React, { useState } from "react";
import { Plus, Minus, Moon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function MothCounter() {
  const [count, setCount] = useState(0);
  return (
    <Card className="max-w-sm mx-auto mt-8">
      <CardHeader><CardTitle className="flex items-center gap-2"><Moon className="w-5 h-5" /> Moths at the lamp</CardTitle></CardHeader>
      <CardContent className="flex items-center gap-4">
        <Button variant="outline" onClick={() => setCount(count - 1)}><Minus /></Button>
        <span className="text-3xl font-bold" data-testid="count">{count}</span>
        <Button onClick={() => setCount(count + 1)}><Plus /></Button>
      </CardContent>
    </Card>
  );
}
`;

const RECHARTS_CHART = `import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type Night = { night: string; moths: number };
const nights: Night[] = [
  { night: "Mon", moths: 12 }, { night: "Tue", moths: 19 }, { night: "Wed", moths: 7 },
];

export default function MothChart() {
  return (
    <div className="p-6 h-80">
      <h1 className="text-xl font-semibold mb-4">Moth census</h1>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={nights}><XAxis dataKey="night" /><YAxis /><Tooltip /><Bar dataKey="moths" fill="#8884d8" /></BarChart>
      </ResponsiveContainer>
    </div>
  );
}
`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Luna moth</title><circle cx="50" cy="50" r="30" fill="#9c6"/></svg>
`;

const MERMAID = `flowchart LR
  egg --> caterpillar --> pupa --> moth
  moth -->|"lays <eggs>"| egg
`;

test("an html artifact with a cdnjs script is served as authored, in the opaque-origin sandbox", async () => {
  const { store, get, write } = await setup();
  write("artifacts/moth-phases.html", HTML_WITH_CDN);
  store.create("Moth phases [publish::moth-phases] [file::artifacts/moth-phases.html]");
  const response = await get("/p/moth-phases");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("content-security-policy")).toBe(SANDBOX);
  expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
  expect(await response.text()).toBe(HTML_WITH_CDN);
});

test("a React artifact (.jsx) with lucide-react, shadcn/ui and Tailwind compiles to a sandboxed page", async () => {
  const { store, get, write } = await setup();
  write("artifacts/moth-counter.jsx", REACT_COUNTER);
  store.create("Moth counter [publish::moth-counter] [file::artifacts/moth-counter.jsx]");
  const response = await get("/p/moth-counter");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("content-security-policy")).toBe(SANDBOX);
  const page = await response.text();
  expect(page).toContain(`<script src="${TAILWIND_PLAY_CDN}"></script>`);
  expect(page).toContain("<title>Moth counter</title>");
  expect(page).toContain("Moths at the lamp");
  expect(page).toContain('<div id="root"></div>');
  // The bundle carries React itself; nothing is imported at run time.
  const module = page.slice(page.indexOf('<script type="module">'));
  expect(module).not.toMatch(/from\s*["']react["']/);
  expect(module).not.toMatch(/^<script type="module">\s*import\b/);
  expect(module.match(/<\/script/gi)).toHaveLength(1);

  // The source is one request away, and the compiled bundle is cached by content.
  expect(await (await get("/p/moth-counter?view=source")).text()).toBe(REACT_COUNTER);
  const builds = readdirSync(join(packageCache, "builds")).length;
  expect(await (await get("/p/moth-counter")).text()).toBe(page);
  expect(readdirSync(join(packageCache, "builds")).length).toBe(builds);

  // Editing the file compiles the new source.
  write("artifacts/moth-counter.jsx", REACT_COUNTER.replace("Moths at the lamp", "Moths at the sheet"));
  const edited = await (await get("/p/moth-counter")).text();
  expect(edited).toContain("Moths at the sheet");
  expect(edited).not.toContain("Moths at the lamp");
}, COMPILE_TIMEOUT);

test("a recharts chart in a .tsx artifact compiles", async () => {
  const { store, get, write } = await setup();
  write("artifacts/moth-chart.tsx", RECHARTS_CHART);
  store.create("Moth census chart [publish::moth-chart] [file::artifacts/moth-chart.tsx]");
  const response = await get("/p/moth-chart");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-security-policy")).toBe(SANDBOX);
  expect(await response.text()).toContain("Moth census");
}, COMPILE_TIMEOUT);

test("a compile error is a readable page naming the line, with no paths from this machine", async () => {
  const { root, store, get, write } = await setup();
  write("artifacts/broken.jsx", "import { useState } from \"react\";\nexport default function Broken( {\n  return <p>half a moth</p>;\n}\n");
  store.create("Broken artifact [publish::broken] [file::artifacts/broken.jsx]");
  const response = await get("/p/broken");
  expect(response.status).toBe(422);
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  const page = await response.text();
  expect(page).toContain("This artifact does not compile");
  expect(page).toContain("line 3");
  for (const secret of [packageCache, root, tmpdir(), "node_modules", "at "]) expect(page).not.toContain(secret);

  write("artifacts/unknown-icon.jsx", "import { NotAMothIcon } from \"lucide-react\";\nexport default () => <NotAMothIcon />;\n");
  store.create("Unknown icon [publish::unknown-icon] [file::artifacts/unknown-icon.jsx]");
  const unknown = await (await get("/p/unknown-icon")).text();
  expect(unknown).toContain("NotAMothIcon");
  expect(unknown).not.toContain(packageCache);
}, COMPILE_TIMEOUT);

test("an artifact may import only the pinned packages and shadcn/ui: files, paths and URLs are refused", async () => {
  const { store, get, write } = await setup();
  write("artifacts/secret.txt", "the neighbour's gate code");
  const cases: Record<string, string> = {
    "left-pad": "import pad from \"left-pad\";\nexport default () => <p>{pad(\"moth\", 8)}</p>;\n",
    relative: "import gate from \"./secret.txt\" with { type: \"text\" };\nexport default () => <p>{gate}</p>;\n",
    absolute: "import hosts from \"/etc/hosts\" with { type: \"text\" };\nexport default () => <p>{hosts}</p>;\n",
    url: "import confetti from \"https://esm.sh/canvas-confetti\";\nexport default () => <p>{String(confetti)}</p>;\n",
    escape: "import x from \"react/../../package.json\";\nexport default () => <p>{String(x)}</p>;\n",
  };
  for (const [name, source] of Object.entries(cases)) {
    write(`artifacts/${name}.jsx`, source);
    store.create(`Refused ${name} [publish::refused-${name}] [file::artifacts/${name}.jsx]`);
    const response = await get(`/p/refused-${name}`);
    expect(response.status).toBe(422);
    const page = await response.text();
    expect(page).toContain("is not available");
    expect(page).not.toContain("gate code");
  }
  expect(artifactPackageFor("recharts")).toBe("recharts");
  expect(artifactPackageFor("lodash/debounce")).toBe("lodash");
  expect(artifactPackageFor("plotly")).toBe("plotly.js-dist-min");
  expect(artifactPackageFor("d3-scale")).toBe("d3");
  expect(artifactPackageFor("@/components/ui/card")).toBeNull();
  expect(artifactPackageFor("react/../x")).toBeNull();
}, COMPILE_TIMEOUT);

test("compiling never runs the artifact's code: a macro import is refused, not executed", async () => {
  const { root, store, get, write } = await setup();
  const marker = join(root, "macro-ran");
  const macro = write("artifacts/lamp.ts", `export function lamp() { require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran"); return "on"; }\n`);
  write("artifacts/macro.jsx", `import { lamp } from ${JSON.stringify(macro)} with { type: "macro" };\nexport default () => <p>{lamp()}</p>;\n`);
  store.create("Macro [publish::macro] [file::artifacts/macro.jsx]");
  const response = await get("/p/macro");
  expect(response.status).toBe(422);
  expect(existsSync(marker)).toBe(false);
}, COMPILE_TIMEOUT);

/**
 * A package cache with stand-ins for the pinned packages, so these tests run
 * offline: `lodash` here writes a marker file if it is ever run on the server,
 * and a `d3-lantern` package sits in a node_modules folder above the cache.
 */
function standInCache() {
  const root = mkdtempSync(join(tmpdir(), "outliner-artifact-standin-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const cache = join(root, "state", "artifacts");
  const marker = join(root, "lodash-ran");
  const pkg = (directory: string, name: string, version: string, main: string) => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version, main: "index.js",
      exports: { ".": "./index.js", "./client": "./index.js", "./jsx-runtime": "./index.js" } }));
    writeFileSync(join(directory, "index.js"), main);
  };
  const react = "export const jsx = () => 0, jsxs = () => 0, Fragment = 0, createElement = () => 0; export class Component {}\n" +
    "export const createRoot = () => ({ render() {} }); export default {};\n";
  pkg(join(cache, "node_modules", "react"), "react", "18.3.1", react);
  pkg(join(cache, "node_modules", "react-dom"), "react-dom", "18.3.1", react);
  pkg(join(cache, "node_modules", "d3"), "d3", "7.9.0", "export const moths = 3;\n");
  pkg(join(cache, "node_modules", "lodash"), "lodash", "4.17.21",
    `const fs = require("node:fs");\nexports.lamp = () => { fs.writeFileSync(${JSON.stringify(marker)}, "ran"); return "on"; };\n`);
  pkg(join(root, "state", "node_modules", "d3-lantern"), "d3-lantern", "1.0.0", "export default \"beyond the cache\";\n");
  return { root, cache, marker, compiler: new ArtifactCompiler({ cacheDirectory: cache }) };
}

test("a macro import of a pinned package is refused under every spelling, and never run", async () => {
  const { marker, compiler } = standInCache();
  const spellings = [
    `import { lamp } from "lodash" with { type: "macro" };\nexport default () => lamp();\n`,
    `import { lamp } from "lodash" assert { type: "macro" };\nexport default () => lamp();\n`,
    `export { lamp } from "lodash" with { type: "macro" };\nexport default () => 1;\n`,
    `import { lamp } from "macro:lodash";\nexport default () => lamp();\n`,
  ];
  for (const source of spellings) {
    const build = await compiler.compile(source, ".jsx");
    expect(build.ok).toBe(false);
    expect(existsSync(marker)).toBe(false);
  }
  // A dynamic import or require with the attribute only bundles the package for the browser.
  const dynamic = await compiler.compile(`export default async () => (await import("lodash", { with: { type: "macro" } })).lamp();\n`, ".jsx");
  const required = await compiler.compile(`const { lamp } = require("lodash");\nexport default () => lamp();\n`, ".jsx");
  expect(dynamic.ok && required.ok).toBe(true);
  expect(existsSync(marker)).toBe(false);
});

test("a bundle names no path on this machine: __dirname, import.meta and module.id are fixed", async () => {
  const { root, compiler } = standInCache();
  const build = await compiler.compile(
    "export default () => [__dirname, __filename, import.meta.dir, import.meta.dirname, import.meta.path, import.meta.file,\n" +
    "  import.meta.filename, import.meta.url, module.id, module.filename];\n", ".jsx");
  expect(build.ok).toBe(true);
  if (!build.ok) return;
  for (const secret of [root, root.slice(1), tmpdir(), "state/artifacts"]) expect(build.script).not.toContain(secret);
});

test("a d3-* import resolves only inside the package cache, never in a node_modules above it", async () => {
  const { compiler } = standInCache();
  const build = await compiler.compile(`import lantern from "d3-lantern";\nexport default () => lantern;\n`, ".jsx");
  expect(build.ok).toBe(false);
  if (build.ok) return;
  expect(build.problems.join("\n")).toContain("\"d3-lantern\" is not available");
  const d3 = await compiler.compile(`import { moths } from "d3";\nexport default () => moths;\n`, ".jsx");
  expect(d3.ok).toBe(true);
});

test("an svg artifact is served as svg in the sandbox; a mermaid artifact gets a page that draws it", async () => {
  const { store, get, write } = await setup();
  write("artifacts/luna.svg", SVG);
  write("artifacts/life-cycle.mermaid", MERMAID);
  write("artifacts/life-cycle-short.mmd", MERMAID);
  store.create("Luna moth [publish::luna] [file::artifacts/luna.svg]");
  store.create("Life cycle [publish::life-cycle] [file::artifacts/life-cycle.mermaid]");
  store.create("Life cycle, short [publish::life-cycle-short] [file::artifacts/life-cycle-short.mmd]");

  const svg = await get("/p/luna");
  expect(svg.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
  expect(svg.headers.get("content-security-policy")).toBe(SANDBOX);
  expect(await svg.text()).toBe(SVG);

  for (const slug of ["life-cycle", "life-cycle-short"]) {
    const response = await get(`/p/${slug}`);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(SANDBOX);
    const page = await response.text();
    expect(page).toContain(MERMAID_MODULE);
    // The diagram is text in the page, never markup.
    expect(page).toContain("moth --&gt;|&quot;lays &lt;eggs&gt;&quot;| egg");
    expect(page).not.toContain("<eggs>");
  }
  expect(await (await get("/p/life-cycle?view=source")).text()).toBe(MERMAID);
});

test("a code artifact is plain text; the index says what each artifact is", async () => {
  const { store, get, write } = await setup({ artifactCacheDirectory: null });
  write("artifacts/count_moths.py", "print(sum([12, 19, 7]))\n");
  write("artifacts/moth-counter.jsx", REACT_COUNTER);
  write("artifacts/luna.svg", SVG);
  store.create("Count moths [publish::count-moths] [file::artifacts/count_moths.py]");
  store.create("Moth counter [publish::moth-counter] [file::artifacts/moth-counter.jsx]");
  store.create("Luna moth [publish::luna] [file::artifacts/luna.svg]");
  const code = await get("/p/count-moths");
  expect(code.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await code.text()).toBe("print(sum([12, 19, 7]))\n");
  const index = await (await get("/index.txt")).text();
  expect(index).toMatch(/react\s+\S+ \S+\s+\/p\/moth-counter/);
  expect(index).toMatch(/svg\s+\S+ \S+\s+\/p\/luna/);
  // A publisher without a package cache says so instead of compiling.
  const uncompiled = await get("/p/moth-counter");
  expect(uncompiled.status).toBe(503);
  expect(await uncompiled.text()).toContain("not compiled");
});

test("a bundle inlined in the page cannot close its script element", () => {
  expect(inlineScript('const tag = "</script><script>alert(1)</script>"; /<!--x/;'))
    .toBe('const tag = "<\\/script><script>alert(1)<\\/script>"; /<\\x21--x/;');
});


test("a named folder goes through the service and snapshots keep its earlier bytes", async () => {
  const { root, store, client, get } = await setup();
  const staticServer = Bun.serve({ port: 0, fetch: request => artifactResponse(join(root, ".artifacts"), request, "https://notes.example.test") });
  const oldOrigin = process.env.EP0CH_ARTIFACT_ORIGIN;
  process.env.EP0CH_ARTIFACT_ORIGIN = staticServer.url.origin;
  cleanups.push(() => { staticServer.stop(true); if (oldOrigin === undefined) delete process.env.EP0CH_ARTIFACT_ORIGIN; else process.env.EP0CH_ARTIFACT_ORIGIN = oldOrigin; });
  const live = await client.request<ArtifactInfo>({ action: "artifacts.put", name: "moth-site", files: { "index.html": '<h1>First night</h1><link rel="stylesheet" href="assets/theme.css">', "assets/theme.css": "body{color:purple}" } });
  expect(await (await fetch(live.url!)).text()).toContain("First night");
  const css = await fetch(new URL("assets/theme.css", live.url!));
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(await css.text()).toBe("body{color:purple}");
  const frozen = await client.request<ArtifactInfo>({ action: "artifacts.snapshot", name: "moth-site" });
  expect(frozen.version).toBe(1);
  await client.request({ action: "artifacts.put", name: "moth-site", files: { "index.html": "<h1>Second night</h1>" } });
  expect(await (await fetch(live.url!)).text()).toContain("Second night");
  expect(await (await fetch(frozen.url!)).text()).toContain("First night");
  writeFileSync(join(root, ".artifacts/live/moth-site/index.html"), "Saved by sync");
  expect(await (await fetch(live.url!)).text()).toBe("Saved by sync");
  const response = await fetch(live.url!);
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors https://notes.example.test");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect((await fetch(new URL("assets/", live.url!))).status).toBe(404);
  symlinkSync(join(root, "garden"), join(root, ".artifacts/live/moth-site/leak"));
  expect((await fetch(new URL("leak/", live.url!))).status).toBe(404);
  rmSync(join(root, ".artifacts/live/moth-site/leak"));
  expect((await fetch(live.url!.replace(/\/[a-f0-9-]{36}\//, "/unknown/"))).status).toBe(404);
  await expect(client.request({ action: "artifacts.put", name: "escape", files: { "../stolen.html": "bad" } })).rejects.toThrow("Unsafe artifact path");
  const oldLimit = process.env.EP0CH_ARTIFACT_MAX_BYTES;
  process.env.EP0CH_ARTIFACT_MAX_BYTES = "4";
  try {
    await expect(client.request({ action: "artifacts.put", name: "moth-site", files: { "index.html": "Too large" } })).rejects.toThrow("exceeds");
    expect(await (await fetch(live.url!)).text()).toBe("Saved by sync");
    await expect(client.request({ action: "artifacts.snapshot", name: "moth-site" })).rejects.toThrow("exceeds");
  } finally { if (oldLimit === undefined) delete process.env.EP0CH_ARTIFACT_MAX_BYTES; else process.env.EP0CH_ARTIFACT_MAX_BYTES = oldLimit; }
  const versions = await client.request<{ versions: { version: number; hash: string }[] }>({ action: "artifacts.versions", name: "moth-site" });
  expect(versions.versions[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
  store.create("Moth exhibit [publish::moth-exhibit]\n[artifact::moth-site]");
  const html = await (await get("/p/moth-exhibit?view=html")).text();
  expect(html).toContain(`src="${live.url}"`);
  expect(html.match(/<iframe[^>]*>/)?.[0]).toContain('sandbox="allow-scripts allow-popups allow-forms allow-pointer-lock allow-downloads"');
  await client.request({ action: "artifacts.rm", name: "moth-site@1" });
  expect((await fetch(frozen.url!)).status).toBe(404);
  expect((await client.request<ArtifactInfo>({ action: "artifacts.snapshot", name: "moth-site" })).version).toBe(2);
});

test("import finishes past collisions and recognises unchanged aliases on a rerun", async () => {
  const { root, client, write } = await setup();
  write("artifacts/amber.html", "Imported amber");
  await client.request({ action: "artifacts.import" });
  await client.request({ action: "artifacts.put", name: "birch", files: { "index.html": "Existing birch" } });
  write("artifacts/birch.html", "Incoming birch");
  write("artifacts/cedar.html", "Incoming cedar");
  const result = await client.request<{ imported: ArtifactInfo[]; alreadyThere: string[]; collided: { entry: string; name: string }[]; counts: object }>({ action: "artifacts.import" });
  expect(result.imported.map(a => a.name)).toEqual(["cedar"]);
  expect(result.alreadyThere).toEqual(["amber.html"]);
  expect(result.collided).toEqual([{ entry: "birch.html", name: "birch" }]);
  expect(result.counts).toEqual({ imported: 1, alreadyThere: 1, collided: 1, skipped: 0 });
  expect(readFileSync(join(root, ".artifacts/live/birch/index.html"), "utf8")).toBe("Existing birch");
  expect(readFileSync(join(root, ".artifacts/live/cedar/cedar.html"), "utf8")).toBe("Incoming cedar");
  write("artifacts/amber.html", "Changed amber");
  const again = await client.request<typeof result>({ action: "artifacts.import" });
  expect(again.collided).toContainEqual({ entry: "amber.html", name: "amber" });
  expect(again.alreadyThere).toEqual(["cedar.html"]);
  expect(readFileSync(join(root, ".artifacts/live/amber/amber.html"), "utf8")).toBe("Imported amber");
});

test("import refuses a symlink at the artifacts root and names its path", async () => {
  const { root, workspace, client } = await setup();
  const outside = join(root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "lantern.html"), "Outside the workspace");
  const source = join(workspace, "artifacts");
  symlinkSync(outside, source);
  await expect(client.request({ action: "artifacts.import" })).rejects.toThrow(`Import refuses link ${source}`);
  expect(existsSync(join(root, ".artifacts/live/lantern"))).toBe(false);
});

test("tar uploads count directory and empty file entries against the cap", async () => {
  const { root, client } = await setup();
  const source = join(root, "upload-source");
  mkdirSync(join(source, "empty"), { recursive: true });
  writeFileSync(join(source, "index.html"), "");
  const tar = Bun.spawn(["tar", "--format=ustar", "-cf", "-", "-C", source, "empty", "index.html"], { stdout: "pipe", stderr: "pipe" });
  const archive = await new Response(tar.stdout).arrayBuffer();
  expect(await tar.exited).toBe(0);
  const oldLimit = process.env.EP0CH_ARTIFACT_MAX_ENTRIES;
  cleanups.push(() => {
    if (oldLimit === undefined) delete process.env.EP0CH_ARTIFACT_MAX_ENTRIES;
    else process.env.EP0CH_ARTIFACT_MAX_ENTRIES = oldLimit;
  });
  await client.request({ action: "artifacts.put", name: "lantern", files: { "index.html": "Earlier page" } });
  const upload = async () => {
    const { upload } = await client.request<{ upload: string }>({ action: "artifacts.upload.begin", name: "lantern" });
    await client.request({ action: "artifacts.upload.chunk", upload, data: Buffer.from(archive).toString("base64") });
    return client.request({ action: "artifacts.upload.finish", upload });
  };
  process.env.EP0CH_ARTIFACT_MAX_ENTRIES = "1";
  await expect(upload()).rejects.toThrow(/2 entries.*1/);
  expect(readFileSync(join(root, ".artifacts/live/lantern/index.html"), "utf8")).toBe("Earlier page");
  expect(readdirSync(join(root, ".artifacts")).some(name => name.endsWith(".tar") || name.endsWith(".incoming"))).toBe(false);
  process.env.EP0CH_ARTIFACT_MAX_ENTRIES = "2";
  await upload();
  expect(readFileSync(join(root, ".artifacts/live/lantern/index.html"), "utf8")).toBe("");
});

test("a direct put refuses compiled bytes over the cap and keeps the live page", async () => {
  const { root, client } = await setup();
  await client.request({ action: "artifacts.put", name: "lantern", files: { "index.html": "Earlier page" } });
  const oldLimit = process.env.EP0CH_ARTIFACT_MAX_BYTES;
  process.env.EP0CH_ARTIFACT_MAX_BYTES = "128";
  cleanups.push(() => {
    if (oldLimit === undefined) delete process.env.EP0CH_ARTIFACT_MAX_BYTES;
    else process.env.EP0CH_ARTIFACT_MAX_BYTES = oldLimit;
  });
  await expect(client.request({ action: "artifacts.put", name: "lantern", files: {
    "lantern.jsx": "export default () => <p>Lantern</p>",
  } })).rejects.toThrow("exceeds 128 bytes after compilation");
  expect(readFileSync(join(root, ".artifacts/live/lantern/index.html"), "utf8")).toBe("Earlier page");
}, COMPILE_TIMEOUT);

test("settled inbox drops become versions and receipts, while bad drops keep their source and reason", async () => {
  const { root, client } = await setup();
  const inbox = join(root, "dropbox");
  const oldEnv = { ...process.env };
  process.env.EP0CH_ARTIFACT_INBOX = inbox;
  process.env.EP0CH_ARTIFACT_SETTLE_MS = "200";
  const staticServer = Bun.serve({ port: 0, fetch: request => artifactResponse(join(root, ".artifacts"), request, "https://notes.example.test") });
  process.env.EP0CH_ARTIFACT_ORIGIN = staticServer.url.origin;
  cleanups.push(() => {
    staticServer.stop(true);
    for (const key of ["EP0CH_ARTIFACT_INBOX", "EP0CH_ARTIFACT_SETTLE_MS", "EP0CH_ARTIFACT_ORIGIN", "EP0CH_ARTIFACT_MAX_BYTES"]) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  });
  mkdirSync(inbox);
  writeFileSync(join(inbox, "Moth Counter.jsx"), 'export default () => <p>First moth</p>');
  const watcher = new ArtifactStore(root);
  watcher.startWatcher(); cleanups.push(() => watcher.close());
  mkdirSync(join(inbox, "garden"));
  writeFileSync(join(inbox, "garden/index.html"), "Authored HTML");
  writeFileSync(join(inbox, "garden/app.jsx"), "source shipped beside the built page");
  mkdirSync(join(inbox, "source-bundle"));
  writeFileSync(join(inbox, "source-bundle/app.jsx"), "source only, kept as given");
  writeFileSync(join(inbox, "garden/.mutagen-temporary-asset"), "still syncing");
  writeFileSync(join(inbox, "broken.jsx"), "export default () => <");
  writeFileSync(join(inbox, ".mutagen-temporary-drop"), "still syncing");
  await Bun.sleep(120);
  writeFileSync(join(inbox, "garden/index.html"), "Settled HTML");
  await Bun.sleep(120);
  expect(existsSync(join(inbox, "garden/index.html"))).toBe(true);
  const waitFor = async (ready: () => boolean) => {
    const end = Date.now() + 30_000;
    while (!ready()) { if (Date.now() > end) throw new Error("Inbox pickup did not finish"); await Bun.sleep(50); }
  };
  const receipts = join(inbox, "receipts.log");
  await waitFor(() => existsSync(receipts) && readFileSync(receipts, "utf8").trim().split("\n").length === 3 && existsSync(join(inbox, ".failed/broken.jsx/reason.txt")));
  for (const [name, content] of [["moth-counter", "First moth"], ["garden", "Settled HTML"]]) {
    const info = await client.request<ArtifactInfo>({ action: "artifacts.show", name: `${name}@1` });
    expect(await (await fetch(info.url!)).text()).toContain(content!);
    expect(readFileSync(receipts, "utf8")).toContain(`\t${name}\t1\t${info.url}`);
  }
  expect(readFileSync(join(root, ".artifacts/live/source-bundle/app.jsx"), "utf8")).toBe("source only, kept as given");
  expect(existsSync(join(root, ".artifacts/live/source-bundle/index.html"))).toBe(false);
  expect(existsSync(join(root, ".artifacts/live/garden/.mutagen-temporary-asset"))).toBe(false);
  expect(existsSync(join(inbox, "Moth Counter.jsx"))).toBe(false);
  expect(existsSync(join(inbox, "garden"))).toBe(false);
  expect(readFileSync(join(inbox, ".failed/broken.jsx/source/broken.jsx"), "utf8")).toBe("export default () => <");
  expect(readFileSync(join(inbox, ".failed/broken.jsx/reason.txt"), "utf8")).toMatch(/compile|Unexpected|Expected/i);
  expect(existsSync(join(inbox, ".mutagen-temporary-drop"))).toBe(true);
  writeFileSync(join(inbox, "Moth Counter.jsx"), 'export default () => <p>Second moth</p>');
  await waitFor(() => readFileSync(receipts, "utf8").trim().split("\n").length === 4);
  const latest = await client.request<ArtifactInfo>({ action: "artifacts.show", name: "moth-counter" });
  expect(await (await fetch(latest.url!)).text()).toContain("Second moth");
  const pinned = await client.request<ArtifactInfo>({ action: "artifacts.show", name: "moth-counter@1" });
  expect(await (await fetch(pinned.url!)).text()).toContain("First moth");
  expect(readFileSync(receipts, "utf8")).toMatch(/\d{4}-\d{2}-\d{2}T[^\t]+\tmoth-counter\t2\t/);
  process.env.EP0CH_ARTIFACT_MAX_BYTES = "32";
  writeFileSync(join(inbox, "oversized.html"), "x".repeat(33));
  writeFileSync(join(inbox, "reason.txt"), "unknown kind");
  writeFileSync(join(inbox, "compiled.jsx"), "export default () => <p />");
  for (const [entry, reason] of [["oversized.html", "exceeds"], ["reason.txt", "Unknown artifact kind"], ["compiled.jsx", "exceeds 32 bytes after compilation"]]) {
    const failed = join(inbox, ".failed", entry!);
    await waitFor(() => existsSync(join(failed, "reason.txt")));
    expect(readFileSync(join(failed, "reason.txt"), "utf8")).toContain(reason!);
    expect(readFileSync(join(failed, "source", entry!), "utf8")).toBe(entry === "reason.txt" ? "unknown kind" : entry === "compiled.jsx" ? "export default () => <p />" : "x".repeat(33));
    expect(existsSync(join(inbox, entry!))).toBe(false);
  }
  expect(readFileSync(receipts, "utf8").trim().split("\n")).toHaveLength(4);

}, COMPILE_TIMEOUT);


test("each artifact ref has its own capability and removing live revokes its old URL", async () => {
  const { root, client } = await setup();
  const oldOrigin = process.env.EP0CH_ARTIFACT_ORIGIN;
  process.env.EP0CH_ARTIFACT_ORIGIN = "https://artifacts.example.test";
  cleanups.push(() => { if (oldOrigin === undefined) delete process.env.EP0CH_ARTIFACT_ORIGIN; else process.env.EP0CH_ARTIFACT_ORIGIN = oldOrigin; });
  const serve = (url: string) => artifactResponse(join(root, ".artifacts"), new Request(url), "*");
  const live = await client.request<ArtifactInfo>({ action: "artifacts.put", name: "capability", files: { "index.html": "Live" } });
  const pinned = await client.request<ArtifactInfo>({ action: "artifacts.snapshot", name: "capability" });
  const second = await client.request<ArtifactInfo>({ action: "artifacts.snapshot", name: "capability" });
  expect(serve(live.url!.replace("/capability/", "/capability@1/")).status).toBe(404);
  expect(serve(pinned.url!.replace("capability%401", "capability")).status).toBe(404);
  expect(serve(pinned.url!.replace("capability%401", "capability%402")).status).toBe(404);
  await client.request({ action: "artifacts.rm", name: "capability" });
  const replacement = await client.request<ArtifactInfo>({ action: "artifacts.put", name: "capability", files: { "index.html": "Replacement" } });
  expect(replacement.url).not.toBe(live.url);
  expect(serve(live.url!).status).toBe(404);
  expect(await serve(pinned.url!).text()).toBe("Live");
  await client.request({ action: "artifacts.rm", name: "capability@2" });
  expect(serve(second.url!).status).toBe(404);
});

test("read-only copies can show, list and read versions of machine artifacts", async () => {
  const { root, client } = await setup();
  await client.request({ action: "artifacts.put", name: "lantern", files: { "index.html": "Lantern" } });
  await client.request({ action: "artifacts.snapshot", name: "lantern" });
  const paths = scratchOutline(join(root, "copy-host"), { folder: join(root, "copy") });
  const store = new OutlinerStore(paths.database, { workspaceRoot: join(root, "copy") });
  const server = new OutlinerServer(store, paths.socket, undefined, undefined, { readOnly: true, outlinesFolder: root });
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); });
  const copy = new OutlinerClient(paths.socket);
  expect((await copy.request<ArtifactInfo>({ action: "artifacts.show", name: "lantern" })).files).toContain("index.html");
  expect((await copy.request<{ artifacts: ArtifactInfo[] }>({ action: "artifacts.list" })).artifacts.some(a => a.name === "lantern")).toBe(true);
  expect((await copy.request<{ versions: ArtifactInfo[] }>({ action: "artifacts.versions", name: "lantern" })).versions[0]?.version).toBe(1);
  await expect(copy.request({ action: "artifacts.rm", name: "lantern" })).rejects.toThrow(/read.only/i);
});

test("mermaid and markdown puts serve rendered HTML beside their source", async () => {
  const { root, client } = await setup();
  const oldOrigin = process.env.EP0CH_ARTIFACT_ORIGIN;
  process.env.EP0CH_ARTIFACT_ORIGIN = "https://artifacts.example.test";
  cleanups.push(() => { if (oldOrigin === undefined) delete process.env.EP0CH_ARTIFACT_ORIGIN; else process.env.EP0CH_ARTIFACT_ORIGIN = oldOrigin; });
  for (const [name, source, expected] of [["diagram.mermaid", MERMAID, MERMAID_MODULE], ["guide.md", "# Lantern guide", "<h1>Lantern guide</h1>"]]) {
    const info = await client.request<ArtifactInfo>({ action: "artifacts.put", name: "rendered", files: { [name!]: source! } });
    expect(info.files).toContain("index.html");
    const page = artifactResponse(join(root, ".artifacts"), new Request(info.url!), "*");
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain(expected!);
    expect(readFileSync(join(root, ".artifacts/live/rendered", name!), "utf8")).toBe(source!);
  }
});

test("an interrupted snapshot does not prevent listing or creating complete versions", async () => {
  const { root, client } = await setup();
  await client.request({ action: "artifacts.put", name: "lantern", files: { "index.html": "Lantern" } });
  mkdirSync(join(root, ".artifacts/snapshots/lantern/1/files"), { recursive: true });
  writeFileSync(join(root, ".artifacts/snapshots/lantern/1/files/index.html"), "Incomplete");
  mkdirSync(join(root, ".artifacts/sequences"), { recursive: true });
  writeFileSync(join(root, ".artifacts/sequences/lantern"), "1");
  expect((await client.request<{ versions: ArtifactInfo[] }>({ action: "artifacts.versions", name: "lantern" })).versions).toEqual([]);
  const next = await client.request<ArtifactInfo>({ action: "artifacts.snapshot", name: "lantern" });
  expect(next.version).toBe(2);
  expect((await client.request<{ versions: ArtifactInfo[] }>({ action: "artifacts.versions", name: "lantern" })).versions.map(v => v.version)).toEqual([2]);
});

test("import skips hidden entries and handles spaced names without losing later files", async () => {
  const { client, write } = await setup();
  write("artifacts/.DS_Store", "metadata");
  write("artifacts/!!!.html", "No usable name");
  write("artifacts/Pulse Pad.html", "Pulse pad");
  write("artifacts/zebra.html", "Zebra");
  const result = await client.request<{ imported: ArtifactInfo[]; skipped: { entry: string; reason: string }[] }>({ action: "artifacts.import" });
  expect(result.imported.map(a => a.name)).toEqual(["pulse-pad", "zebra"]);
  expect(result.skipped[0]?.entry).toBe("!!!.html");
  expect(result.skipped[0]?.reason).toContain("artifact name");
  expect((await client.request<ArtifactInfo>({ action: "artifacts.show", name: "artifacts/Pulse Pad.html" })).name).toBe("pulse-pad");
});

test("file maps, import and inbox drops enforce the same entry cap before installation", async () => {
  const { root, client, write } = await setup();
  const oldEnv = { ...process.env };
  const inbox = join(root, "capped-inbox");
  process.env.EP0CH_ARTIFACT_MAX_ENTRIES = "1";
  process.env.EP0CH_ARTIFACT_INBOX = inbox;
  process.env.EP0CH_ARTIFACT_SETTLE_MS = "10";
  cleanups.push(() => { for (const key of ["EP0CH_ARTIFACT_MAX_ENTRIES", "EP0CH_ARTIFACT_INBOX", "EP0CH_ARTIFACT_SETTLE_MS"]) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]; } });
  await expect(client.request({ action: "artifacts.put", name: "crowded", files: { "a.html": "", "b.html": "" } })).rejects.toThrow(/entries.*cap/);
  write("artifacts/crowded/a.html", ""); write("artifacts/crowded/b.html", "");
  write("artifacts/zebra.html", "Zebra");
  const imported = await client.request<{ imported: ArtifactInfo[]; skipped: { entry: string; reason: string }[] }>({ action: "artifacts.import" });
  expect(imported.imported.map(a => a.name)).toEqual(["zebra"]);
  expect(imported.skipped[0]?.reason).toMatch(/entries.*cap/);
  mkdirSync(join(inbox, "crowded"), { recursive: true });
  writeFileSync(join(inbox, "crowded/a.html"), ""); writeFileSync(join(inbox, "crowded/b.html"), "");
  const watcher = new ArtifactStore(root);
  watcher.startWatcher(); cleanups.push(() => watcher.close());
  const reason = join(inbox, ".failed/crowded/reason.txt");
  const until = Date.now() + 5000;
  while (!existsSync(reason) && Date.now() < until) await Bun.sleep(20);
  expect(readFileSync(reason, "utf8")).toMatch(/entries.*cap/);
  expect(existsSync(join(root, ".artifacts/live/crowded"))).toBe(false);
});


test("artifact file lines enter the store, follow edits and retain the last snapshot when deleted", async () => {
  const { root, workspace, store, client, get, write } = await setup();
  const oldOrigin = process.env.EP0CH_ARTIFACT_ORIGIN;
  process.env.EP0CH_ARTIFACT_ORIGIN = "https://artifacts.example.test";
  cleanups.push(() => { if (oldOrigin === undefined) delete process.env.EP0CH_ARTIFACT_ORIGIN; else process.env.EP0CH_ARTIFACT_ORIGIN = oldOrigin; });
  const source = write("sketches/Lantern.jsx", 'export default () => <p>First lantern</p>');
  const refs = [source, "sketches/Lantern.jsx", `~/${relative(homedir(), source)}`];
  const text = `File art [publish::file-art]\n${refs.map(ref => `- [artifact::${ref}]`).join("\n")}`;
  const note = store.create(text);
  await client.request({ action: "artifacts.put", name: "lantern", files: { "index.html": "Existing artifact" } });
  const show = (name: string) => client.request<ArtifactInfo>({ action: "artifacts.show", name });
  const first = await show(source);
  expect(first.name).toBe("lantern-2");
  expect(first.version).toBe(1);
  const serve = (info: ArtifactInfo) => artifactResponse(join(root, ".artifacts"), new Request(info.url!), "*");
  expect(await serve(first).text()).toContain("First lantern");
  for (const ref of refs) expect(await show(ref)).toEqual(first);
  expect(await (await get("/p/file-art?view=html")).text()).toContain(`src="${first.url}"`);
  expect((await get(`/p/${note.id}/artifact/1`)).headers.get("location")).toBe(first.url);
  writeFileSync(source, 'export default () => <p>Second lantern</p>');
  const second = await show(source);
  expect(second.name).toBe(first.name);
  expect(second.version).toBe(2);
  expect(await serve(second).text()).toContain("Second lantern");
  expect(await serve(first).text()).toContain("First lantern");
  expect((await show(source)).version).toBe(2);
  const other = write("other/Lantern.jsx", 'export default () => <p>Other lantern</p>');
  expect((await show(other)).name).toBe("lantern-3");
  // Imported aliases and spelling the same path with ./ must keep following one file.
  write("artifacts/Pulse.html", "First pulse");
  await client.request({ action: "artifacts.import" });
  const pulse = await show("artifacts/Pulse.html");
  expect((await show("./artifacts/Pulse.html")).name).toBe(pulse.name);
  write("artifacts/Pulse.html", "Second pulse");
  expect(await serve(await show("artifacts/Pulse.html")).text()).toBe("Second pulse");
  rmSync(source);
  const gone = await show(source);
  expect(gone.url).toBe(second.url);
  expect(gone.warning).toMatch(/file gone since \d{4}-/);
  expect(await serve(gone).text()).toContain("Second lantern");
  expect((await show(source)).warning).toBe(gone.warning);
  expect(store.get(note.id)?.text).toBe(text);
  // A fresh store instance reads the durable path index, rather than minting another name.
  const reopened = new ArtifactStore(root);
  expect(await reopened.request({ action: "artifacts.show", name: refs[1]! }, workspace)).toEqual(gone);
  writeFileSync(source, 'export default () => <p>Second lantern</p>');
  expect(await show(source)).toEqual(second);
  const a = write("parallel-a.html", "A"), b = write("parallel-b.html", "B");
  const peer = new ArtifactStore(root);
  const [one, two] = await Promise.all([
    reopened.request({ action: "artifacts.show", name: a }, workspace) as Promise<ArtifactInfo>,
    peer.request({ action: "artifacts.show", name: b }, workspace) as Promise<ArtifactInfo>,
  ]);
  expect((await show(a)).name).toBe(one.name);
  expect((await show(b)).name).toBe(two.name);
  await client.request({ action: "artifacts.rm", name: `${one.name}@${one.version}` });
  const restored = await show(a);
  expect(restored.name).toBe(one.name);
  expect(restored.version).toBe(2);
  expect(await serve(restored).text()).toBe("A");
  await reopened.close(); await peer.close();
}, COMPILE_TIMEOUT);


test("artifact file refusals name the host, supported kinds and concrete repair calls", async () => {
  const { client, write, workspace, store } = await setup();
  const oldMachine = process.env.EP0CH_MACHINE_NAME;
  process.env.EP0CH_MACHINE_NAME = "garden-host";
  cleanups.push(() => { if (oldMachine === undefined) delete process.env.EP0CH_MACHINE_NAME; else process.env.EP0CH_MACHINE_NAME = oldMachine; });
  const unreadable = write("private.jsx", "export default () => <p>Private</p>");
  chmodSync(unreadable, 0);
  cleanups.push(() => chmodSync(unreadable, 0o600));
  const wrong = write("sketch.txt", "Not an artifact");
  const missing = join(workspace, "missing.jsx");
  const folder = join(workspace, "entry"); mkdirSync(folder);
  const refs = [wrong, unreadable, missing, folder];
  const text = `Unfinished art\n${refs.map(ref => `- [artifact::${ref}]`).join("\n")}`;
  const note = store.create(text);
  const show = (name: string) => client.request({ action: "artifacts.show", name });
  await expect(show(wrong)).rejects.toThrow(`.jsx, .tsx, .html, .svg or .mermaid`);
  await expect(show(wrong)).rejects.toThrow(`ep0ch artifact put '${wrong}' --name sketch --machine garden-host`);
  for (const [file, name, code] of [[unreadable, "private", "EACCES"], [missing, "missing", "ENOENT"]]) {
    await expect(show(file!)).rejects.toThrow(`on garden-host (${code})`);
    await expect(show(file!)).rejects.toThrow(`ep0ch artifact put '${file}' --name ${name} --machine garden-host`);
  }
  await expect(show(folder)).rejects.toThrow(`[artifact::${join(folder, "index.html")}]`);
  await expect(show("entry")).rejects.toThrow(`[artifact::${join(folder, "index.html")}]`);
  expect(store.get(note.id)?.text).toBe(text);
});

test("unimported artifact paths still render and recompile after a file edit", async () => {
  const extraRoot = mkdtempSync(join(tmpdir(), "outliner-artifact-root-"));
  cleanups.push(() => rmSync(extraRoot, { recursive: true, force: true }));
  const { store, get, write } = await setup({ roots: [extraRoot] });
  const absolute = join(extraRoot, "external.html");
  writeFileSync(absolute, "<h1>Absolute page</h1>");
  const paths = ["notes/chart.jsx", "./artifacts/x.html", "artifacts/demos/x.jsx", absolute];
  write(paths[0]!, "export default () => <p>First chart</p>");
  write("artifacts/x.html", "<h1>Relative page</h1>");
  write(paths[2]!, "export default () => <p>Nested chart</p>");
  const note = store.create(`Paths [publish::paths]\n${paths.map(path => `[artifact::${path}]`).join("\n")}`);
  const html = await (await get("/p/paths?view=html")).text();
  for (let line = 1; line <= paths.length; line++) {
    const route = `/p/${note.id}/artifact/${line}`;
    expect(html).toContain(`src="${route}"`);
    expect((await get(route)).status).toBe(200);
  }
  write(paths[0]!, "export default () => <p>Changed chart</p>");
  expect(await (await get(`/p/${note.id}/artifact/1`)).text()).toContain("Changed chart");
}, COMPILE_TIMEOUT);


test("closing a store after overlapping path reads still waits for its inbox pickup", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-artifact-overlap-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const inbox = join(root, "inbox"); mkdirSync(inbox);
  const old = { inbox: process.env.EP0CH_ARTIFACT_INBOX, settle: process.env.EP0CH_ARTIFACT_SETTLE_MS };
  process.env.EP0CH_ARTIFACT_INBOX = inbox; process.env.EP0CH_ARTIFACT_SETTLE_MS = "1";
  cleanups.push(() => {
    for (const [key, value] of [["EP0CH_ARTIFACT_INBOX", old.inbox], ["EP0CH_ARTIFACT_SETTLE_MS", old.settle]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  });
  const watched = new ArtifactStore(root), peer = new ArtifactStore(root);
  const receipts = join(inbox, "receipts.log");
  const waitFor = async (ready: () => boolean) => {
    const end = Date.now() + 30_000;
    while (!ready()) { if (Date.now() > end) throw new Error("Inbox pickup did not finish"); await Bun.sleep(1); }
  };
  watched.startWatcher();
  writeFileSync(join(inbox, "many-lamps.jsx"), `export default () => <div>${"<span>Lamp</span>".repeat(40_000)}</div>`);
  try {
    await waitFor(() => readdirSync(watched.root).some(name => name.endsWith(".incoming")));
    const a = join(root, "a.html"), b = join(root, "b.html");
    writeFileSync(a, "A"); writeFileSync(b, "B");
    const other = peer.request({ action: "artifacts.show", name: a }, root);
    await watched.request({ action: "artifacts.show", name: b }, root);
    await other;
    await watched.close();
    expect(existsSync(receipts)).toBe(true);
    expect(readFileSync(join(watched.live, "many-lamps/index.html"), "utf8")).toContain("Lamp");
  } finally {
    try { await waitFor(() => existsSync(receipts) || existsSync(join(inbox, ".failed/many-lamps.jsx/reason.txt"))); }
    finally { await watched.close(); await peer.close(); }
  }
}, COMPILE_TIMEOUT);


test("artifact symlinks use the target kind and read the checked open file", async () => {
  const { client, write, workspace, root } = await setup();
  const target = write("drawing.svg", "<svg>Lantern</svg>");
  const link = join(workspace, "drawing.html"); symlinkSync(target, link);
  const original = fs.fstatSync;
  let replaced = false;
  const probe = spyOn(fs, "fstatSync").mockImplementation(((...args: Parameters<typeof fs.fstatSync>) => {
    const result = original(...args);
    if (!replaced && result.ino === fs.statSync(target).ino) {
      replaced = true;
      fs.renameSync(target, `${target}.previous`);
      writeFileSync(target, "<svg>Replacement</svg>");
    }
    return result;
  }) as typeof fs.fstatSync);
  let info: ArtifactInfo;
  try { info = await client.request<ArtifactInfo>({ action: "artifacts.show", name: link }); }
  finally { probe.mockRestore(); }
  expect(replaced).toBe(true);
  expect(readFileSync(join(root, ".artifacts/snapshots", info.name, String(info.version), "files/drawing.svg"), "utf8")).toBe("<svg>Lantern</svg>");
  rmSync(link); symlinkSync(write("other/drawing.html", "<svg>Lantern</svg>"), link);
  const retargeted = await client.request<ArtifactInfo>({ action: "artifacts.show", name: link });
  expect(retargeted.files).toContain("drawing.html");
  expect(retargeted.version).toBe(info.version! + 1);
  const jsx = "export default () => <p>Same bytes, different target kind</p>";
  rmSync(link); symlinkSync(write("other/counter.jsx", jsx), link);
  const compiled = await client.request<ArtifactInfo>({ action: "artifacts.show", name: link });
  rmSync(link); symlinkSync(write("other/index.html", jsx), link);
  const html = await client.request<ArtifactInfo>({ action: "artifacts.show", name: link });
  expect(readFileSync(join(root, ".artifacts/snapshots", html.name, String(html.version), "files/index.html"), "utf8")).toBe(jsx);
  expect(html.version).toBe(compiled.version! + 1);
  rmSync(link); symlinkSync(write("credentials.txt", "fictional key"), link);
  await expect(client.request({ action: "artifacts.show", name: link })).rejects.toThrow(/target.*isn't an artifact/i);
  rmSync(link); symlinkSync(write(".env", "FICTIONAL=value"), link);
  await expect(client.request({ action: "artifacts.show", name: link })).rejects.toThrow(/target.*isn't an artifact/i);
}, COMPILE_TIMEOUT);

test("artifact paths refuse canonical hidden segments and explain the visible copy or explicit put", async () => {
  const { client, write, workspace } = await setup();
  for (const relative of [".secret.html", ".config/panel.html", ".ssh/panel.html"]) {
    const target = write(relative, "<p>Fictional private panel</p>");
    const link = join(workspace, "visible.html"); symlinkSync(target, link);
    for (const name of [target, link]) {
      await expect(client.request({ action: "artifacts.show", name })).rejects.toThrow(/hidden.*copy.*visible.*ep0ch artifact put/i);
      await expect(client.request({ action: "artifacts.show", name })).rejects.toThrow(`ep0ch artifact put '${target}' --name `);
    }
    rmSync(link);
  }
});

test("unchanged artifact paths do no source reads and concurrent resolves share one read", async () => {
  const { client, write } = await setup();
  const source = write("cached.html", "<p>First lantern</p>");
  const identity = fs.statSync(source);
  const original = fs.readFileSync;
  let reads = 0;
  const probe = spyOn(fs, "readFileSync").mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
    const file = args[0];
    if (file === source || (typeof file === "number" && fs.fstatSync(file).ino === identity.ino && fs.fstatSync(file).dev === identity.dev)) reads++;
    return original(...args);
  }) as typeof fs.readFileSync);
  try {
    const show = () => client.request<ArtifactInfo>({ action: "artifacts.show", name: source });
    const first = await show();
    expect(reads).toBe(1);
    reads = 0;
    expect(await show()).toEqual(first);
    expect(reads).toBe(0);
    writeFileSync(source, "<p>Changed lantern</p>");
    const [second, concurrent] = await Promise.all([show(), show()]);
    expect(second.version).toBe(2);
    expect(concurrent).toEqual(second);
    expect(reads).toBe(1);
  } finally { probe.mockRestore(); }
});
