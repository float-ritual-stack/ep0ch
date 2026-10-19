import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OutlinerStore } from "../src/store";
import { OutlinerServer } from "../src/server";
import { OutlinerClient } from "../src/client";
import { scratchOutline } from "./scratch-outline";
import { artifactResponse } from "../src/artifact-server";
import { artifactDestination } from "../src/artifact-deploy";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });

async function fixture(app = false) {
  const root = mkdtempSync(join(tmpdir(), "deploy-")), paths = scratchOutline(root);
  const bin = join(root, "bin"); mkdirSync(bin);
  writeFileSync(join(root, "commit"), "abc123");
  const old = { ...process.env };
  process.env.EP0CH_ARTIFACT_DEPLOYS = join(root, "clones");
  process.env.ARTIFACT_FIXTURE = root;
  const wrapper = (name: string, source: string) => {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\nset -eu\nprintf '%s\\n' '${name}' "$@" >> "$ARTIFACT_FIXTURE/calls"\n${source}\n`, { mode: 0o700 });
    process.env[`EP0CH_${name.toUpperCase().replaceAll("-", "_")}`] = file;
  };
  wrapper("git", `case "$1" in
clone) mkdir -p "$3/.git"; printf '<h1>Moth garden</h1>' > "$3/index.html"; ${app ? `printf '{"scripts":{"build":"vite build"}}' > "$3/package.json";` : ""} ;;
remote) printf 'https://github.com/ep0ch-artifacts/moth-garden\n';;
fetch|reset) :;;
rev-parse) cat "$ARTIFACT_FIXTURE/commit";;
ls-files) printf 'index.html\\0${app ? "package.json\\0" : ""}';;
*) exit 8;;
esac`);
  wrapper("vercel", `case "$1" in
list) if [ -e "$ARTIFACT_FIXTURE/deployed-commit" ] && [ "$(cat "$ARTIFACT_FIXTURE/deployed-commit")" = "$(cat "$ARTIFACT_FIXTURE/commit")" ]; then printf '{"deployments":[{"name":"moth-garden","state":"READY","url":"moth-garden.example.test"}]}'; else printf '{"deployments":[]}'; fi;;
link|domains) :;;
deploy) test ! -e "$ARTIFACT_FIXTURE/fail-vercel"; cp "$ARTIFACT_FIXTURE/commit" "$ARTIFACT_FIXTURE/deployed-commit"; printf 'deployed\\n' >> "$ARTIFACT_FIXTURE/deploys"; printf 'https://moth-garden.example.test';;
inspect) host=\${2#https://}; name=\${host%%.*}; if [ "$name" = kalku-run ] && [ -e "$ARTIFACT_FIXTURE/missing-deployment" ]; then printf "Error: Can't find the deployment %s under the context evan-schultzs-projects\\n" "$host" >&2; exit 1; fi; if [ "$name" = plastik-kraft ] && [ -e "$ARTIFACT_FIXTURE/login-failure" ]; then printf 'Error: You are not logged in (401)\\n' >&2; exit 1; fi; printf '{"id":"%s","createdAt":1700000000000}' "$name";;
api) name=\${2##*/}; printf '{"createdAt":1700000000000,"meta":{"githubCommitOrg":"ep0ch-artifacts","githubCommitRepo":"%s","githubCommitSha":"abc123"}}' "$name";;
*) exit 8;;
esac`);
  wrapper("gh", `printf '[{"name":"moth-garden","url":"https://github.com/ep0ch-artifacts/moth-garden","homepageUrl":"https://moth-garden.example.test"}]'`);
  wrapper("hcloud", `case "$3" in
list) printf '[]';;
create|set-records|delete) printf 'dns\\n' >> "$ARTIFACT_FIXTURE/dns";;
*) exit 8;;
esac`);
  wrapper("with-secrets", `if [ "$1" = --list ]; then
  if [ -e "$ARTIFACT_FIXTURE/token" ]; then printf 'hetzner-dns\\n'; fi
else
  shift; shift; exec "$@"
fi`);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket, undefined, undefined, { outlinesFolder: paths.outlines, ruleQuietMs: 20 });
  await server.start();
  cleanup.push(async () => { await server.extensionRules.settle(); await server.close(); store.close(); process.env = old; rmSync(root, { recursive: true, force: true }); });
  const client = new OutlinerClient(paths.socket);
  const cli = async (...args: string[]) => {
    const p = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../door/src/main.ts"), "artifact", ...args, "--ws", "scratch"], {
      env: { ...process.env, ...paths.env, EP0CH_SOCKET: paths.socket, EP0CH_MACHINE: "", XDG_CONFIG_HOME: join(root, "config") }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  };
  return { root, paths, store, server, client, cli };
}

test("deploying through the CLI publishes a static repo, registers it and skips the same commit", async () => {
  const { paths, store, cli, client } = await fixture();
  const note = store.create("Moth garden [artifact::ep0ch-artifacts/moth-garden]", null, "agent", { actorId: "ext:fixture" });
  const first = await cli("deploy", "ep0ch-artifacts/moth-garden");
  expect(first.err).toBe(""); expect(first.code).toBe(0);
  expect(JSON.parse(first.out)).toMatchObject({ where: "float-2", commit: "abc123", outcome: "deployed" });
  expect(store.get(note.id)!.text).toContain("[url::https://artifacts.ep0ch.sh/moth-garden/]");
  const catalogue = store.resolveBlockRef("[[artifacts]]");
  expect(store.children(catalogue.id).some(b => b.text.includes("abc123"))).toBe(true);
  for (const url of ["https://artifacts.ep0ch.sh/moth-garden/", "https://moth-garden.ep0ch.sh/"]) {
    const response = artifactResponse(join(paths.outlines, ".artifacts"), new Request(url), "*");
    expect(response.status).toBe(200); expect(await response.text()).toContain("Moth garden");
  }
  const again = await cli("deploy", "moth-garden");
  expect(again.code).toBe(0); expect(JSON.parse(again.out).outcome).toBe("up-to-date");
  await client.request({ action: "artifacts.put", name: "moth-garden", files: { "index.html": "Manually replaced" } });
  const restored = await cli("deploy", "moth-garden");
  expect(JSON.parse(restored.out).outcome).toBe("deployed");
  const refused = await cli("deploy", "elsewhere/moth-garden");
  expect(refused.code).toBe(1); expect(refused.err).toContain("gh repo fork https://github.com/elsewhere/moth-garden --org ep0ch-artifacts");
  expect(refused.err).toContain("gh api -X POST repos/elsewhere/moth-garden/transfer -f new_owner=ep0ch-artifacts");
});

test.each([
  ["single HTML", ["lamp.html"], undefined, "float-2"],
  ["single JSX", ["lamp.jsx"], undefined, "float-2"],
  ["built files", ["index.html", "assets/main.js"], undefined, "float-2"],
  ["package without build", ["index.html", "package.json"], { scripts: { test: "bun test" } }, "float-2"],
  ["build", ["package.json"], { scripts: { build: "build-it" } }, "vercel"],
  ["Next", ["package.json"], { dependencies: { next: "1" } }, "vercel"],
  ["Vite", ["package.json"], { devDependencies: { vite: "1" } }, "vercel"],
  ["SvelteKit", ["package.json"], { dependencies: { "@sveltejs/kit": "1" } }, "vercel"],
  ["API", ["api/hello.ts"], undefined, "vercel"],
  ["root API route", ["app/route.ts"], undefined, "vercel"],
  ["Svelte API route", ["src/routes/+server.ts"], undefined, "vercel"],
  ["server", ["package.json"], { scripts: { start: "node server.js" } }, "vercel"],
] as const)("%s selects its destination", (_name, files, pkg, where) => {
  expect(artifactDestination(files, pkg).where).toBe(where);
});

test("a saved property runs the shared deployment action, redeploys a new commit and keeps capture on failure", async () => {
  const { root, client, store, server, cli } = await fixture(true);
  const note = await client.request<{ id: string }>({ action: "create", text: "Moth garden [artifact::github.com/ep0ch-artifacts/moth-garden]", author: "user" });
  await server.extensionRules.settle();
  for (const started = Date.now(); !store.get(note.id)!.text.includes("[url::") && Date.now() - started < 5000;) await Bun.sleep(20);
  expect(store.get(note.id)!.text).toContain("[url::https://moth-garden.ep0ch.sh]");
  expect(readFileSync(join(root, "deploys"), "utf8")).toBe("deployed\n");
  expect(existsSync(join(root, "dns"))).toBe(false);
  const run = store.queryBlocks({ filters: [{ key: "type", value: "artifact-run" }] }).blocks[0]!;
  expect(run.text).toContain("build script"); expect(run.text).toContain("CNAME cname.vercel-dns.com.");
  expect(run.actorId).toBe("ext:artifact-deploy");
  expect((await cli("deploy", "moth-garden")).code).toBe(0);
  expect(readFileSync(join(root, "deploys"), "utf8")).toBe("deployed\n");
  writeFileSync(join(root, "commit"), "def456"); writeFileSync(join(root, "token"), "present");
  expect((await cli("deploy", "moth-garden")).code).toBe(0);
  expect(readFileSync(join(root, "deploys"), "utf8")).toBe("deployed\ndeployed\n");
  expect(readFileSync(join(root, "dns"), "utf8")).toBe("dns\n");
  const listed = await cli("ls"); expect(listed.code).toBe(0);
  expect(JSON.parse(listed.out).artifacts).toContainEqual(expect.objectContaining({ where: "vercel", url: "https://moth-garden.ep0ch.sh", commit: "def456" }));
  writeFileSync(join(root, "commit"), "bad789"); writeFileSync(join(root, "fail-vercel"), "fail");
  const failed = await cli("deploy", "moth-garden"); expect(failed.code).toBe(1);
  expect(store.get(note.id)!.text).toContain("[artifact::github.com/ep0ch-artifacts/moth-garden]");
  expect(store.queryBlocks({ where: "type=artifact-run status=failed" }).blocks.some(b => b.text.includes("vercel deploy exited 1"))).toBe(true);
  expect((await cli("dns", "moth-garden", "--to", "float-2")).code).toBe(0);
});

test("backfill imports existing URLs without deploying", async () => {
  const { root, store, cli } = await fixture();
  const result = await cli("backfill"); expect(result.err).toBe(""); expect(result.code).toBe(0);
  expect(JSON.parse(result.out).imported.every((r: { commit: string }) => r.commit === "abc123")).toBe(true);
  expect(JSON.parse(result.out).imported.some((r: { url: string }) => r.url === "https://goose.ep0ch.sh")).toBe(true);
  expect(store.children(store.resolveBlockRef("[[artifacts]]").id).some(b => b.text.includes("https://moth-garden.example.test"))).toBe(true);
  expect(existsSync(join(root, "deploys"))).toBe(false); expect(existsSync(join(root, "dns"))).toBe(false);
});

test("backfill registers a missing domain as pending and continues with the other domains", async () => {
  const { root, store, cli } = await fixture();
  writeFileSync(join(root, "missing-deployment"), "");
  const result = await cli("backfill");
  expect(result.code).toBe(0);
  const report = JSON.parse(result.out);
  expect(report.summary).toBe("6 domains: 5 registered, 1 pending (kalku-run: no Vercel deployment for that domain)");
  expect(report.imported.filter((row: { name: string }) => ["kalku-run", "plastik-kraft", "plastik-loop", "ansi-culture", "kalku-path", "goose"].includes(row.name))).toHaveLength(5);
  const rows = store.children(store.resolveBlockRef("[[artifacts]]").id);
  expect(rows.find(row => row.text.startsWith("kalku-run "))?.text).toContain("[where::unknown]");
  expect(rows.find(row => row.text.startsWith("kalku-run "))?.text).toContain("[url::pending]");
  expect(rows.find(row => row.text.startsWith("kalku-run "))?.text).toContain("no Vercel deployment for that domain");
  expect(rows.some(row => row.text.startsWith("goose ") && row.text.includes("[where::vercel]"))).toBe(true);
  const listed = await cli("ls");
  expect(listed.code).toBe(0);
  expect(JSON.parse(listed.out).artifacts).toContainEqual(expect.objectContaining({ name: "kalku-run", where: "unknown", url: "pending" }));
});

test("backfill calls out a real Vercel login failure separately", async () => {
  const { root, store, cli } = await fixture();
  writeFileSync(join(root, "login-failure"), "");
  const result = await cli("backfill");
  expect(result.code).toBe(0);
  const report = JSON.parse(result.out);
  expect(report.pending).toContain("plastik-kraft: Vercel login failed; run vercel login on the outline host and run the artifact command again.");
  expect(store.children(store.resolveBlockRef("[[artifacts]]").id).find(row => row.text.startsWith("plastik-kraft "))?.text).toContain("[where::unknown] [deployed-at::unknown]");
  expect(report.imported.some((row: { name: string }) => row.name === "goose")).toBe(true);
});
