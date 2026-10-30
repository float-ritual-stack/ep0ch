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
clone) if [ -e "$ARTIFACT_FIXTURE/clone-failure" ]; then printf "fatal: could not read Username for 'https://github.com': terminal prompts disabled" >&2; exit 128; fi; mkdir -p "$3/.git"; printf '<h1>Moth garden</h1>' > "$3/index.html"; ${app ? `printf '{"scripts":{"build":"vite build"}}' > "$3/package.json";` : ""} ;;
remote) printf 'https://github.com/ep0ch-artifacts/moth-garden\n';;
fetch|reset) :;;
rev-parse) cat "$ARTIFACT_FIXTURE/commit";;
ls-files) printf 'index.html\\0${app ? "package.json\\0" : ""}';;
*) exit 8;;
esac`);
  wrapper("vercel", `
for arg in "$@"; do
  case "$arg" in
  --*) case "$1:$arg" in
    list:--all|list:--prod|list:--json|list:--limit|list:--meta|list:--next|project:--json|project:--limit|project:--next|link:--yes|link:--project|deploy:--prod|deploy:--yes|deploy:--meta|inspect:--json|*:--scope) :;;
    *) printf 'Error: unsupported flag %s' "$arg" >&2; exit 1;;
  esac;;
  esac
  if [ "$arg" = e-schultz ]; then printf 'Error: You cannot set your Personal Account as the scope.' >&2; exit 1; fi
done
case "$1" in
list) all=0; project=0; shift
while [ "$#" -gt 0 ]; do
 case "$1" in
 --all) all=1;;
 --prod|--json) :;;
 --limit|--meta|--scope|--next) shift;;
 --*) exit 8;;
 *) project=1;;
 esac
 shift
done
if [ "$all" = 1 ] && [ "$project" = 1 ]; then printf 'Error: Cannot use --all flag with a project argument' >&2; exit 1; fi
if [ -e "$ARTIFACT_FIXTURE/deployed-commit" ] && [ "$(cat "$ARTIFACT_FIXTURE/deployed-commit")" = "$(cat "$ARTIFACT_FIXTURE/commit")" ]; then printf '{"deployments":[{"name":"moth-garden","state":"READY","url":"moth-garden.example.test"}]}'; else printf '{"deployments":[]}'; fi;;
project) printf '{"projects":[{"name":"moth-garden"}],"pagination":{"next":null}}';;
link) if [ -e "$ARTIFACT_FIXTURE/mapped-project" ]; then test "$4" = lantern; fi;;
domains) test "$2" = add; test "$#" = 4; printf '%s' "$3" > "$ARTIFACT_FIXTURE/added-domain";;
deploy) test ! -e "$ARTIFACT_FIXTURE/fail-vercel"; cp "$ARTIFACT_FIXTURE/commit" "$ARTIFACT_FIXTURE/deployed-commit"; printf 'deployed\\n' >> "$ARTIFACT_FIXTURE/deploys"; printf 'https://moth-garden.example.test';;
inspect) test "$3" = --json; host=\${2#https://}; name=\${host%%.*}; if { [ "$name" = moon ] || [ "$name" = glow ]; } && { [ ! -e "$ARTIFACT_FIXTURE/added-domain" ] || [ "$(cat "$ARTIFACT_FIXTURE/added-domain")" != "$host" ]; }; then printf "Error: Can't find the deployment" >&2; exit 1; fi; if [ "$name" = kalku-run ] && [ -e "$ARTIFACT_FIXTURE/missing-deployment" ]; then printf "Error: Can't find the deployment %s under the context evan-schultzs-projects\\n" "$host" >&2; exit 1; fi; if [ "$name" = plastik-kraft ] && [ -e "$ARTIFACT_FIXTURE/login-failure" ]; then printf 'Error: You are not logged in (401)\\n' >&2; exit 1; fi; printf '{"id":"%s","createdAt":1700000000000}' "$name";;
api) case "$2" in
/v9/projects/*/domains*) if [ -e "$ARTIFACT_FIXTURE/custom-domain" ]; then printf '{"domains":[{"name":"lantern.ep0ch.sh"}],"pagination":{"next":null}}'; else printf '{"domains":[],"pagination":{"next":null}}'; fi;;
/v13/deployments/*) name=\${2##*/}; project="$name"; if [ "$name" = moon ] || [ "$name" = glow ]; then project=moth-garden; fi; if [ -e "$ARTIFACT_FIXTURE/mapped-project" ] && [ "$name" = kalku-run ]; then name=moth-garden; project=lantern; fi; printf '{"name":"%s","createdAt":1700000000000,"meta":{"githubCommitOrg":"ep0ch-artifacts","githubCommitRepo":"%s","githubCommitSha":"abc123"}}' "$project" "$name";;
*) exit 8;;
esac;;
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
    const response = await artifactResponse(join(paths.outlines, ".artifacts"), new Request(url), "*");
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

test("private clone failures explain the gh credential helper", async () => {
  const { root, cli } = await fixture();
  writeFileSync(join(root, "clone-failure"), "");
  const result = await cli("deploy", "moth-garden");
  expect(result.code).toBe(1);
  expect(result.err).toContain("gh auth setup-git");
});

test.each([false, true])("existing domains keep their project without domain or DNS writes (backfilled: %s)", async (backfilled) => {
  const { root, cli } = await fixture(true);
  writeFileSync(join(root, "custom-domain"), "");
  if (backfilled) {
    writeFileSync(join(root, "mapped-project"), "");
    expect((await cli("backfill")).code).toBe(0);
  }
  writeFileSync(join(root, "commit"), "next456");
  const result = await cli("deploy", "moth-garden");
  expect(result.err).toBe(""); expect(result.code).toBe(0);
  expect(JSON.parse(result.out)).toMatchObject({ url: "https://lantern.ep0ch.sh", commit: "next456" });
  expect(readFileSync(join(root, "deploys"), "utf8")).toBe("deployed\n");
  expect(existsSync(join(root, "added-domain"))).toBe(false);
  expect(existsSync(join(root, "dns"))).toBe(false);
});

test("the CLI domain overrides the note domain, and saved notes use their domain", async () => {
  const { root, cli, store, client, server } = await fixture(true);
  const note = store.create("Moth garden [artifact::ep0ch-artifacts/moth-garden] [domain::glow]", null, "agent", { actorId: "ext:fixture" });
  const result = await cli("deploy", "moth-garden", "--domain", "moon");
  expect(result.err).toBe(""); expect(result.code).toBe(0);
  expect(JSON.parse(result.out).url).toBe("https://moon.ep0ch.sh");
  expect(readFileSync(join(root, "added-domain"), "utf8")).toBe("moon.ep0ch.sh");
  // The next edit uses the note's domain even though this commit was already deployed.
  await client.request({ action: "update", blockId: note.id, text: store.get(note.id)!.text + "\nEdited", expectedRevision: store.get(note.id)!.revision, mutation: { author: "user" } });
  await server.extensionRules.settle();
  for (const started = Date.now(); !store.get(note.id)!.text.includes("[url::https://glow.ep0ch.sh]") && Date.now() - started < 5000;) await Bun.sleep(20);
  expect(store.get(note.id)!.text).toContain("[url::https://glow.ep0ch.sh]");
  expect(readFileSync(join(root, "added-domain"), "utf8")).toBe("glow.ep0ch.sh");
});

type Shown = { name: string; url: string | null; deploy?: { repo: string; state: string; url?: string; recorded?: string; said?: string; command?: string; run?: { id: string; title: string } } };

test("a repo on a line of a note, as a URL, deploys on save and artifacts.show answers its deploy state", async () => {
  const { client, store, server, root } = await fixture();
  const repo = "https://github.com/ep0ch-artifacts/moth-garden";
  expect((await client.request<Shown>({ action: "artifacts.show", name: repo })).deploy).toMatchObject({ state: "not-deployed", command: "ep0ch artifact deploy ep0ch-artifacts/moth-garden" });
  const note = await client.request<{ id: string }>({ action: "create", text: `Trying things\n\n[artifact::${repo}]`, author: "user" });
  await server.extensionRules.settle();
  const runs = () => store.queryBlocks({ where: "type=artifact-run" }).blocks;
  for (const started = Date.now(); !runs().length && Date.now() - started < 5000;) await Bun.sleep(20);
  const run = runs()[0]!;
  expect(run.text).toContain("Artifact moth-garden: deployed");
  // The run is filed under the catalogue, where the card's link leads, not loose at the top of the outline.
  expect(run.parentId).toBe(store.resolveBlockRef("[[artifacts]]").id);
  const shown = await client.request<Shown>({ action: "artifacts.show", name: repo });
  expect(shown).toMatchObject({ name: "moth-garden", url: "https://artifacts.ep0ch.sh/moth-garden/", deploy: { repo: "ep0ch-artifacts/moth-garden", state: "live", run: { id: run.id, title: "Artifact moth-garden: deployed" } } });
  // The line stays as written: a token added to it would stop it being an artifact line.
  expect(store.get(note.id)!.text).toBe(`Trying things\n\n[artifact::${repo}]`);
  // Saving again checks again and refreshes that run's note rather than adding one per edit.
  await client.request({ action: "update", blockId: note.id, text: `${store.get(note.id)!.text}\nmore`, expectedRevision: store.get(note.id)!.revision, mutation: { author: "user" } });
  await server.extensionRules.settle();
  for (const started = Date.now(); !store.get(run.id)!.text.includes("Checked again") && Date.now() - started < 5000;) await Bun.sleep(20);
  expect(runs()).toHaveLength(1);
  // A failing run says why and what fixes it, and while one runs the card says it's deploying.
  writeFileSync(join(root, "commit"), "def456"); writeFileSync(join(root, "clone-failure"), "");
  const { rmSync: rm } = await import("node:fs"); rm(join(root, "clones"), { recursive: true, force: true });
  const failing = client.request({ action: "artifacts.deploy", repo: "ep0ch-artifacts/moth-garden" }).catch(() => {});
  expect((await client.request<Shown>({ action: "artifacts.show", name: repo })).deploy?.state).toBe("deploying");
  await failing;
  expect((await client.request<Shown>({ action: "artifacts.show", name: repo })).deploy).toMatchObject({ state: "failed", said: expect.stringContaining("gh auth setup-git"), command: "ep0ch artifact deploy ep0ch-artifacts/moth-garden" });
});

test("a repo outside ep0ch-artifacts is refused with the fork, and an imported deployment of a fork counts as live", async () => {
  const { client, paths } = await fixture();
  const refused = await client.request<Shown>({ action: "artifacts.show", name: "github.com/elsewhere/moth-garden" });
  expect(refused.deploy).toMatchObject({ state: "refused", command: expect.stringContaining("gh repo fork https://github.com/elsewhere/moth-garden --org ep0ch-artifacts") });
  mkdirSync(join(paths.outlines, ".artifacts"), { recursive: true });
  writeFileSync(join(paths.outlines, ".artifacts", "deployments.json"), JSON.stringify([{ name: "lamp-loop", repo: "someone/lamp-loop-original", where: "vercel", url: "https://lamp-loop.ep0ch.sh", commit: "aaa111", deployedAt: "2026-10-01T00:00:00.000Z", reason: "Imported the existing deployment; no redeploy." }]));
  const imported = await client.request<Shown>({ action: "artifacts.show", name: "https://github.com/ep0ch-artifacts/lamp-loop" });
  expect(imported).toMatchObject({ url: "https://lamp-loop.ep0ch.sh", deploy: { state: "live", recorded: "someone/lamp-loop-original" } });
});

test("an earlier seeded deploy rule and script, never edited, are brought up to reading lines", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-seed-")), paths = scratchOutline(root);
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  let store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const actor = { actorId: "ext:artifact-deploy" };
  const script = store.create('Deploy the repo named by this note [script::deploy-artifact] [effects::write] [deadline::5m]\n\n```js\nconst repo = this.properties.find(p => p.key === "artifact");\nif (repo?.values[0]?.includes("/")) text(await tools.artifact_deploy({ repo: repo.values[0], domain: this.properties.find(p => p.key === "domain")?.values[0] }));\n```', null, "agent", actor);
  const { scriptSourceId } = await import("../src/script-sources");
  const action = `${scriptSourceId(script.id)}/run`;
  const rule = store.create(`Deploy repos named by notes [rule-name::deploy-artifact] [rule-match::artifact] [rule-on::${action}] [rule-on-change::${action}]\n\nOnly ep0ch-artifacts repos deploy. The repo decides the destination; remove this rule to stop automatic deployment.`, null, "agent", actor);
  store.writeMetadata("artifacts.deploy-rule", rule.id);
  const edited = store.create("Not ours [script::deploy-artifact]\n\n```js\ntext(1)\n```", null, "user");
  store.close();
  store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket, undefined, undefined, { outlinesFolder: paths.outlines });
  await server.start();
  cleanup.push(async () => { await server.close(); store.close(); });
  expect(store.get(rule.id)!.text).toContain("[property-scope::all]");
  expect(store.get(rule.id)!.text).toContain(`[rule-on::${action}]`);
  expect(store.get(script.id)!.text).toContain("tools.artifact_deploy({ note: this.id })");
  expect(store.get(edited.id)!.text).toContain("text(1)");
});

test("a seeded rule someone edited is left as they wrote it", async () => {
  const root = mkdtempSync(join(tmpdir(), "deploy-edited-")), paths = scratchOutline(root);
  cleanup.push(async () => rmSync(root, { recursive: true, force: true }));
  let store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const actor = { actorId: "ext:artifact-deploy" };
  const script = store.create('Deploy the repo named by this note [script::deploy-artifact] [effects::write] [deadline::5m]\n\n```js\nconst repo = this.properties.find(p => p.key === "artifact");\nif (repo?.values[0]?.includes("/")) text(await tools.artifact_deploy({ repo: repo.values[0] }));\n```', null, "agent", actor);
  const { scriptSourceId } = await import("../src/script-sources");
  const action = `${scriptSourceId(script.id)}/run`;
  const rule = store.create(`Deploy repos named by notes [rule-name::deploy-artifact] [rule-match::artifact] [rule-on::${action}] [rule-on-change::${action}] [rule-quiet::30s]\n\nMine now.`, null, "agent", actor);
  store.writeMetadata("artifacts.deploy-rule", rule.id);
  store.close();
  store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket, undefined, undefined, { outlinesFolder: paths.outlines });
  await server.start();
  cleanup.push(async () => { await server.close(); store.close(); });
  expect(store.get(rule.id)!.text).toContain("Mine now.");
  expect(store.get(script.id)!.text).toContain("tools.artifact_deploy({ note: this.id })");
});
