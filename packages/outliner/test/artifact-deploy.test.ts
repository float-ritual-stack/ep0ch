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

async function fixture(app = false, options: { kit?: boolean; before?: (store: OutlinerStore) => Promise<void> } = {}) {
  const root = mkdtempSync(join(tmpdir(), "deploy-")), paths = scratchOutline(root);
  const bin = join(root, "bin"); mkdirSync(bin);
  writeFileSync(join(root, "commit"), "abc123");
  const old = { ...process.env };
  process.env.EP0CH_ARTIFACT_DEPLOYS = join(root, "clones");
  process.env.ARTIFACT_FIXTURE = root;
  process.env.EP0CH_VERCEL_VERIFY_WAIT_MS = "1";
  // A user folder in use, as on float-2: the kit still goes in the outline's own (PIE-1509).
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
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
deploy) test ! -e "$ARTIFACT_FIXTURE/fail-vercel"; cp "$ARTIFACT_FIXTURE/commit" "$ARTIFACT_FIXTURE/deployed-commit"; printf 'deployed\\n' >> "$ARTIFACT_FIXTURE/deploys"; printf 'https://moth-garden.example.test';;
inspect) test "$3" = --json; host=\${2#https://}; name=\${host%%.*}; if [ "$name" = lantern ]; then if [ "$host" != lantern.ep0ch.sh ]; then printf "Error: Can't find the deployment" >&2; exit 1; fi; printf '{"id":"served-lantern","createdAt":1700000000000}'; exit 0; fi; if { [ "$name" = moon ] || [ "$name" = glow ]; } && { [ ! -e "$ARTIFACT_FIXTURE/added-domain" ] || [ "$(cat "$ARTIFACT_FIXTURE/added-domain")" != "$host" ]; }; then printf "Error: Can't find the deployment" >&2; exit 1; fi; if [ "$name" = kalku-run ] && [ -e "$ARTIFACT_FIXTURE/missing-deployment" ]; then printf "Error: Can't find the deployment %s under the context evan-schultzs-projects\\n" "$host" >&2; exit 1; fi; if [ "$name" = plastik-kraft ] && [ -e "$ARTIFACT_FIXTURE/login-failure" ]; then printf 'Error: You are not logged in (401)\\n' >&2; exit 1; fi; printf '{"id":"%s","createdAt":1700000000000}' "$name";;
api) case "$2" in
/v10/projects/*/domains) test "$3" = -X; test "$4" = POST; test "$5" = -f; host=\${6#name=}; printf '%s' "$host" > "$ARTIFACT_FIXTURE/added-domain"; rm -f "$ARTIFACT_FIXTURE/verified-domain"; if [ -e "$ARTIFACT_FIXTURE/refuse-domain" ]; then printf 'Error: Cannot add this domain. (409)' >&2; exit 1; fi; case "$host" in *.vercelheld.example) touch "$ARTIFACT_FIXTURE/verified-domain"; printf '{"name":"%s","verified":true}' "$host";; *) printf '{"name":"%s","verified":false,"verification":[{"type":"TXT","domain":"_vercel.%s","value":"vc-domain-verify=%s,tok3n","reason":"pending_domain_verification"}]}' "$host" "\${host#*.}" "$host";; esac;;
/v9/projects/*/domains/*/verify) test "$3" = -X; test "$4" = POST; printf x >> "$ARTIFACT_FIXTURE/verify-asks"; if [ -e "$ARTIFACT_FIXTURE/verify-slow" ] && [ "$(wc -c < "$ARTIFACT_FIXTURE/verify-asks")" -lt 3 ]; then printf 'Error: the TXT record is not there yet. (400)' >&2; exit 1; fi; if [ -e "$ARTIFACT_FIXTURE/verify-never" ] || { [ ! -e "$ARTIFACT_FIXTURE/txt-records" ] && [ ! -e "$ARTIFACT_FIXTURE/hand-added" ]; }; then printf 'Error: the TXT record is not there yet. (400)' >&2; exit 1; fi; touch "$ARTIFACT_FIXTURE/verified-domain"; printf '{"name":"%s","verified":true}' "$(cat "$ARTIFACT_FIXTURE/added-domain")";;
/v9/projects/*/domains*) if [ -e "$ARTIFACT_FIXTURE/custom-domain" ]; then printf '{"domains":[{"name":"lantern.ep0ch.sh","verified":true}],"pagination":{"next":null}}'; else
  added=""; if [ -e "$ARTIFACT_FIXTURE/added-domain" ]; then host=$(cat "$ARTIFACT_FIXTURE/added-domain"); if [ -e "$ARTIFACT_FIXTURE/verified-domain" ]; then added=$(printf '{"name":"%s","verified":true},' "$host"); else added=$(printf '{"name":"%s","verified":false,"verification":[{"type":"TXT","domain":"_vercel.%s","value":"vc-domain-verify=%s,tok3n"}]},' "$host" "\${host#*.}" "$host"); fi; fi
  other=""; if [ -e "$ARTIFACT_FIXTURE/other-name" ]; then other='{"name":"moth-garden.vercelheld.example","verified":true},'; fi
  printf '{"domains":[%s%s{"name":"moth-garden.vercel.app","verified":true}],"pagination":{"next":null}}' "$added" "$other"; fi;;
/v6/domains/*/config) host=\${2#/v6/domains/}; host=\${host%/config}; case "$host" in *.vercelheld.example) printf '{"misconfigured":false}';; *) if [ -e "$ARTIFACT_FIXTURE/custom-domain" ] || [ -e "$ARTIFACT_FIXTURE/hand-added" ] || [ -e "$ARTIFACT_FIXTURE/dns" ]; then printf '{"misconfigured":false}'; else printf '{"misconfigured":true}'; fi;; esac;;
/v13/deployments/*) name=\${2##*/}; project="$name"; if [ "$name" = served-lantern ]; then name=moth-garden; project=lantern; fi; if [ "$name" = moon ] || [ "$name" = glow ]; then project=moth-garden; fi; if [ -e "$ARTIFACT_FIXTURE/mapped-project" ] && [ "$name" = kalku-run ]; then name=moth-garden; project=lantern; fi; printf '{"name":"%s","createdAt":1700000000000,"meta":{"githubCommitOrg":"ep0ch-artifacts","githubCommitRepo":"%s","githubCommitSha":"abc123"}}' "$project" "$name";;
*) exit 8;;
esac;;
*) exit 8;;
esac`);
  wrapper("gh", `printf '[{"name":"moth-garden","url":"https://github.com/ep0ch-artifacts/moth-garden","homepageUrl":"https://moth-garden.example.test"}]'`);
  // Stateful as the real one is: _vercel's values come back quoted; add-records appends and quotes what it's given.
  wrapper("hcloud", `case "$3" in
list) if [ -e "$ARTIFACT_FIXTURE/hcloud-fails" ]; then printf 'hcloud: boom' >&2; exit 1; fi; printf '['; if [ -e "$ARTIFACT_FIXTURE/txt-records" ]; then printf '{"name":"_vercel","type":"TXT","records":['; sep=""; while IFS= read -r value; do printf '%s{"value":"\\\\"%s\\\\""}' "$sep" "$value"; sep=","; done < "$ARTIFACT_FIXTURE/txt-records"; printf ']}'; fi; printf ']';;
add-records) test "$4" = --record; test "$6" = ep0ch.sh; test "$7" = _vercel; test "$8" = TXT; printf '%s\\n' "$5" >> "$ARTIFACT_FIXTURE/txt-records";;
create|set-records|delete) printf 'dns\\n' >> "$ARTIFACT_FIXTURE/dns";;
*) exit 8;;
esac`);
  wrapper("with-secrets", `if [ "$1" = --list ]; then
  if [ -e "$ARTIFACT_FIXTURE/token" ]; then printf 'hetzner-dns\\n'; fi
else
  shift; shift; exec "$@"
fi`);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  await options.before?.(store);
  const server = new OutlinerServer(store, paths.socket, undefined, undefined, { outlinesFolder: paths.outlines, ruleQuietMs: 20 });
  await server.start();
  cleanup.push(async () => { await server.extensionRules.settle(); await server.close(); store.close(); process.env = old; rmSync(root, { recursive: true, force: true }); });
  const client = new OutlinerClient(paths.socket);
  // Installed as a person does: the power bar's install row runs extensions.install.
  if (options.kit) await client.request({ action: "extensions.install", extension: "artifact-deploy" });
  const cli = async (...args: string[]) => {
    const p = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../door/src/main.ts"), "artifact", ...args, "--ws", "scratch"], {
      env: { ...process.env, ...paths.env, EP0CH_SOCKET: paths.socket, EP0CH_MACHINE: "", XDG_CONFIG_HOME: join(root, "config") }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  };
  return { root, paths, store, server, client, cli };
}

/** Each program call the fakes saw, whole, in order (with-secrets' own line dropped: it runs the program named after it). */
function callsOf(root: string): string[] {
  const calls: string[] = [];
  for (const line of readFileSync(join(root, "calls"), "utf8").split("\n")) {
    if (["git", "vercel", "gh", "hcloud", "with-secrets"].includes(line)) calls.push(line);
    else if (calls.length) calls[calls.length - 1] += ` ${line}`;
  }
  return calls.filter(call => !call.startsWith("with-secrets hetzner-dns"));
}
const SEEDED_TXT = "vc-domain-verify=lamp-yard.ep0ch.sh,e3f7aaaa\n";

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
  const { root, client, store, server, cli } = await fixture(true, { kit: true });
  const note = await client.request<{ id: string }>({ action: "create", text: "Moth garden [artifact::github.com/ep0ch-artifacts/moth-garden]", author: "user" });
  await server.extensionRules.settle();
  for (const started = Date.now(); !store.get(note.id)!.text.includes("[url::") && Date.now() - started < 5000;) await Bun.sleep(20);
  expect(store.get(note.id)!.text).toContain("[url::https://moth-garden.vercel.app]");
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

test("with no record, a --domain finds the project already serving that name instead of starting another", async () => {
  const { root, cli, paths } = await fixture(true);
  writeFileSync(join(root, "custom-domain"), "");
  for (const domain of ["lantern", "lantern.ep0ch.sh"]) {
    const result = await cli("deploy", "moth-garden", "--domain", domain);
    expect(result.err).toBe(""); expect(result.code).toBe(0);
    expect(JSON.parse(result.out).url).toBe("https://lantern.ep0ch.sh");
    const calls = callsOf(root);
    expect(calls.some(call => call.startsWith("vercel inspect https://lantern.ep0ch.sh --json"))).toBe(true);
    expect(calls.filter(call => call.startsWith("vercel link")).every(call => call.includes("--project lantern"))).toBe(true);
    expect(calls.some(call => call.startsWith("vercel api /v10/projects/"))).toBe(false);
    rmSync(join(paths.outlines, ".artifacts", "deployments.json"), { force: true });
    rmSync(join(root, "calls"));
  }
});

test("the CLI domain overrides the note domain, and saved notes use their domain", async () => {
  const { root, cli, store, client, server } = await fixture(true, { kit: true });
  writeFileSync(join(root, "token"), "present");
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

test("a new name ends at its address: domain added through the API, TXT appended, CNAME set, verify asked, deployment recorded", async () => {
  const { root, cli, store } = await fixture(true);
  writeFileSync(join(root, "token"), "present"); writeFileSync(join(root, "txt-records"), SEEDED_TXT);
  const note = store.create("Moth garden [artifact::ep0ch-artifacts/moth-garden]", null, "agent", { actorId: "ext:fixture" });
  const result = await cli("deploy", "ep0ch-artifacts/moth-garden");
  expect(result.err).toBe(""); expect(result.code).toBe(0);
  expect(JSON.parse(result.out)).toMatchObject({ url: "https://moth-garden.ep0ch.sh", where: "vercel", outcome: "deployed" });
  expect(JSON.parse(result.out).wanted).toBeUndefined();
  const calls = callsOf(root);
  const at = (needle: string) => calls.findIndex(call => call.includes(needle));
  const steps = [at("vercel deploy"), at("/v10/projects/moth-garden/domains"), at("add-records"), at("zone rrset create ep0ch.sh --name moth-garden --type CNAME"), at("/domains/moth-garden.ep0ch.sh/verify")];
  expect(steps.every(step => step >= 0)).toBe(true);
  expect(steps).toEqual([...steps].sort((a, b) => a - b));
  expect(calls.some(call => call.startsWith("vercel domains"))).toBe(false);
  // Appended beside what's there, never replaced.
  expect(readFileSync(join(root, "txt-records"), "utf8")).toBe(`${SEEDED_TXT}vc-domain-verify=moth-garden.ep0ch.sh,tok3n\n`);
  expect(calls.some(call => call.includes("set-records") && call.includes("_vercel"))).toBe(false);
  expect(store.get(note.id)!.text).toContain("[url::https://moth-garden.ep0ch.sh]");
});

test("the TXT that can't be written says what Vercel wants; the app stays recorded at the address it answers at", async () => {
  const { root, cli, client, store } = await fixture(true);
  const result = await cli("deploy", "moth-garden");
  expect(result.err).toBe(""); expect(result.code).toBe(0);
  const answer = JSON.parse(result.out);
  expect(answer).toMatchObject({ url: "https://moth-garden.vercel.app", outcome: "deployed", wanted: { name: "moth-garden.ep0ch.sh" } });
  expect(answer.wanted.said).toContain("Vercel wants this DNS record:");
  expect(answer.wanted.said).toContain('_vercel.ep0ch.sh. 300 IN TXT "vc-domain-verify=moth-garden.ep0ch.sh,tok3n"');
  expect(answer.wanted.said).toContain("moth-garden.ep0ch.sh. 300 IN CNAME cname.vercel-dns.com.");
  expect(answer.wanted.said).not.toContain("login");
  expect(existsSync(join(root, "txt-records"))).toBe(false);
  // The card reads a missing name: live, at the address, with what's wanted and the command. Never a failed deploy.
  const shown = await client.request<Shown>({ action: "artifacts.show", name: "ep0ch-artifacts/moth-garden" });
  expect(shown.url).toBe("https://moth-garden.vercel.app");
  expect(shown.deploy).toMatchObject({ state: "live", url: "https://moth-garden.vercel.app", said: expect.stringContaining("Vercel wants this DNS record:"), command: "ep0ch artifact deploy ep0ch-artifacts/moth-garden" });
  const run = store.queryBlocks({ where: "type=artifact-run" }).blocks[0]!;
  expect(run.text).toContain("[status::deployed]");
  expect(run.text).toContain("moth-garden.ep0ch.sh isn't attached");
  // The same answer again refreshes that run rather than adding one per save.
  expect((await cli("deploy", "moth-garden")).code).toBe(0);
  expect(store.queryBlocks({ where: "type=artifact-run" }).blocks).toHaveLength(1);
  // The token arrives, and the same command finishes it from the half-added domain.
  writeFileSync(join(root, "token"), "present");
  const finished = JSON.parse((await cli("deploy", "moth-garden")).out);
  expect(finished).toMatchObject({ url: "https://moth-garden.ep0ch.sh", outcome: "deployed" });
  expect(finished.wanted).toBeUndefined();
  expect(readFileSync(join(root, "deploys"), "utf8")).toBe("deployed\n");
  expect((await client.request<Shown>({ action: "artifacts.show", name: "ep0ch-artifacts/moth-garden" })).deploy).toMatchObject({ state: "live", url: "https://moth-garden.ep0ch.sh" });
  expect((await client.request<Shown>({ action: "artifacts.show", name: "ep0ch-artifacts/moth-garden" })).deploy?.said).toBeUndefined();
});

test("records added by hand count on the next run, with no token", async () => {
  const { root, cli } = await fixture(true);
  expect(JSON.parse((await cli("deploy", "moth-garden")).out).wanted).toBeDefined();
  writeFileSync(join(root, "hand-added"), "");
  const answer = JSON.parse((await cli("deploy", "moth-garden")).out);
  expect(answer).toMatchObject({ url: "https://moth-garden.ep0ch.sh" });
  expect(answer.wanted).toBeUndefined();
});

test("a rerun appends nothing: the TXT is already there, quoted, and the name finishes", async () => {
  const { root, cli } = await fixture(true);
  writeFileSync(join(root, "token"), "present");
  writeFileSync(join(root, "txt-records"), `${SEEDED_TXT}vc-domain-verify=moth-garden.ep0ch.sh,tok3n\n`);
  const result = await cli("deploy", "moth-garden");
  expect(result.code).toBe(0); expect(JSON.parse(result.out).url).toBe("https://moth-garden.ep0ch.sh");
  expect(callsOf(root).some(call => call.includes("add-records"))).toBe(false);
  expect(readFileSync(join(root, "txt-records"), "utf8")).toBe(`${SEEDED_TXT}vc-domain-verify=moth-garden.ep0ch.sh,tok3n\n`);
});

test("verify is asked again while the record reaches Vercel; one that never comes says so and leaves the app recorded", async () => {
  const slow = await fixture(true);
  writeFileSync(join(slow.root, "token"), "present"); writeFileSync(join(slow.root, "verify-slow"), "");
  expect(JSON.parse((await slow.cli("deploy", "moth-garden")).out).url).toBe("https://moth-garden.ep0ch.sh");
  expect(readFileSync(join(slow.root, "verify-asks"), "utf8").length).toBeGreaterThan(1);
  const never = await fixture(true);
  writeFileSync(join(never.root, "token"), "present"); writeFileSync(join(never.root, "verify-never"), "");
  const result = await never.cli("deploy", "moth-garden");
  expect(result.code).toBe(0);
  const answer = JSON.parse(result.out);
  expect(answer.url).toBe("https://moth-garden.vercel.app");
  expect(answer.wanted.said).toContain("Vercel hasn't seen");
  expect(answer.wanted.said).not.toContain("login");
});

test("a full name on a team-held domain on Vercel's nameservers skips the TXT and Hetzner, from the flag or the note", async () => {
  const { root, cli, store, client, server } = await fixture(true, { kit: true });
  writeFileSync(join(root, "token"), "present");
  const result = await cli("deploy", "moth-garden", "--domain", "moon.vercelheld.example");
  expect(result.err).toBe(""); expect(result.code).toBe(0);
  expect(JSON.parse(result.out)).toMatchObject({ url: "https://moon.vercelheld.example", outcome: "deployed" });
  expect(JSON.parse(result.out).wanted).toBeUndefined();
  expect(readFileSync(join(root, "added-domain"), "utf8")).toBe("moon.vercelheld.example");
  const calls = callsOf(root);
  expect(calls.some(call => call.startsWith("hcloud") || call.startsWith("with-secrets"))).toBe(false);
  expect(calls.some(call => call.includes("/verify"))).toBe(false);
  // Again: nothing to do, and the same name without the flag, remembered.
  const again = await cli("deploy", "moth-garden");
  expect(JSON.parse(again.out)).toMatchObject({ url: "https://moon.vercelheld.example", outcome: "up-to-date" });
  // [domain::] takes a full name too.
  const note = store.create("Moth garden [artifact::ep0ch-artifacts/moth-garden] [domain::glow.vercelheld.example]", null, "agent", { actorId: "ext:fixture" });
  await client.request({ action: "update", blockId: note.id, text: `${store.get(note.id)!.text}\nEdited`, expectedRevision: store.get(note.id)!.revision, mutation: { author: "user" } });
  await server.extensionRules.settle();
  for (const started = Date.now(); !store.get(note.id)!.text.includes("[url::https://glow.vercelheld.example]") && Date.now() - started < 5000;) await Bun.sleep(20);
  expect(store.get(note.id)!.text).toContain("[url::https://glow.vercelheld.example]");
});

test("a name on someone else's DNS says the records it needs, and a label or nonsense reads as it should", async () => {
  const { root, cli } = await fixture(true);
  writeFileSync(join(root, "token"), "present");
  const answer = JSON.parse((await cli("deploy", "moth-garden", "--domain", "moon.thirdparty.example")).out);
  expect(answer.wanted.said).toContain('Vercel wants this DNS record: _vercel.thirdparty.example. 300 IN TXT "vc-domain-verify=moon.thirdparty.example,tok3n"');
  expect(answer.wanted.said).toContain("moon.thirdparty.example. 300 IN CNAME cname.vercel-dns.com.");
  expect(callsOf(root).some(call => call.startsWith("hcloud"))).toBe(false);
  const bad = await cli("deploy", "moth-garden", "--domain", "Not A Name!");
  expect(bad.code).toBe(1); expect(bad.err).toContain("--domain");
});

test("a domain step that breaks reads as a missing name, never the login, and the card shows the name that does answer", async () => {
  const { root, cli, client } = await fixture(true);
  writeFileSync(join(root, "other-name"), ""); writeFileSync(join(root, "refuse-domain"), "");
  const result = await cli("deploy", "moth-garden");
  expect(result.code).toBe(0);
  const answer = JSON.parse(result.out);
  expect(answer.url).toBe("https://moth-garden.vercelheld.example");
  expect(answer.wanted.said).toContain("409");
  expect(answer.wanted.said).not.toContain("login");
  expect((await client.request<Shown>({ action: "artifacts.show", name: "ep0ch-artifacts/moth-garden" })).deploy).toMatchObject({ state: "live", url: "https://moth-garden.vercelheld.example", said: expect.stringContaining("moth-garden.ep0ch.sh") });
  // A broken hcloud is the same: the name is what's missing, and the deploy is still recorded.
  const dns = await fixture(true);
  writeFileSync(join(dns.root, "token"), "present"); writeFileSync(join(dns.root, "hcloud-fails"), "");
  const failed = JSON.parse((await dns.cli("deploy", "moth-garden")).out);
  expect(failed).toMatchObject({ url: "https://moth-garden.vercel.app", outcome: "deployed", wanted: { name: "moth-garden.ep0ch.sh" } });
  expect(failed.wanted.said).not.toContain("login");
});

test("a failed vercel deploy is still a failed deploy, and no longer blames the login", async () => {
  const { root, cli, store } = await fixture(true);
  writeFileSync(join(root, "fail-vercel"), "");
  const failed = await cli("deploy", "moth-garden");
  expect(failed.code).toBe(1);
  expect(failed.err).toContain("vercel deploy exited");
  expect(failed.err).not.toContain("login");
  expect(store.queryBlocks({ where: "type=artifact-run status=failed" }).blocks).toHaveLength(1);
});

test("artifact dns reconciles the address by hand, as it did", async () => {
  const { root, cli } = await fixture();
  const manual = await cli("dns", "moth-garden", "--to", "vercel");
  expect(manual.code).toBe(0);
  expect(JSON.parse(manual.out)).toMatchObject({ outcome: "manual", record: "moth-garden.ep0ch.sh. 300 IN CNAME cname.vercel-dns.com." });
  writeFileSync(join(root, "token"), "present");
  expect(JSON.parse((await cli("dns", "moth-garden", "--to", "vercel")).out).outcome).toBe("updated");
  expect(existsSync(join(root, "txt-records"))).toBe(false);
});

test("a repo on a line of a note, as a URL, deploys on save and artifacts.show answers its deploy state", async () => {
  const { client, store, server, root } = await fixture(false, { kit: true });
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

/** Waits for `done`, up to five seconds; answers whether it came. */
async function until(done: () => boolean): Promise<boolean> {
  for (const started = Date.now(); !done() && Date.now() - started < 5000;) await Bun.sleep(20);
  return done();
}
/** The commit the catalogue says is deployed, if any: a plain-files repo deploys to the static store, with no vercel call. */
const deployed = (store: OutlinerStore) => store.queryBlocks({ where: "type=artifact-deployment" }).blocks[0]?.properties.find(p => p.key === "commit")?.value;
type Listed = { extensions: { id: string; state: string; origin: string; directory: string }[]; available?: { id: string }[] };
const kitOf = async (client: OutlinerClient) => (await client.request<Listed>({ action: "extensions.list" })).extensions.find(e => e.id === "artifact-deploy" && e.state !== "shadowed");
const save = async (client: OutlinerClient, store: OutlinerStore, id: string, text: string) =>
  client.request({ action: "update", blockId: id, text, expectedRevision: store.get(id)!.revision, mutation: { author: "user" } });

// The texts the host wrote into every outline before the kit (PIE-1509), the earlier of each: what an old outline holds.
const SEEDED_SCRIPT = 'Deploy the repo named by this note [script::deploy-artifact] [effects::write] [deadline::5m]\n\n```js\nconst repo = this.properties.find(p => p.key === "artifact");\nif (repo?.values[0]?.includes("/")) text(await tools.artifact_deploy({ repo: repo.values[0], domain: this.properties.find(p => p.key === "domain")?.values[0] }));\n```';
const seededRule = (action: string, extra = "", body = "Only ep0ch-artifacts repos deploy. The repo decides the destination; remove this rule to stop automatic deployment.") =>
  `Deploy repos named by notes [rule-name::deploy-artifact] [rule-match::artifact] [rule-on::${action}] [rule-on-change::${action}]${extra}\n\n${body}`;
async function seedOld(store: OutlinerStore, rule: (action: string) => string = seededRule) {
  const actor = { actorId: "ext:artifact-deploy" };
  const { scriptSourceId } = await import("../src/script-sources");
  const script = store.create(SEEDED_SCRIPT, null, "agent", actor);
  const made = store.create(rule(`${scriptSourceId(script.id)}/run`), null, "agent", actor);
  store.writeMetadata("artifacts.deploy-rule", made.id);
  return { script, rule: made };
}

test("a fresh outline deploys nothing until the kit is installed from the install row, in its own folder; uninstalled, it stops", async () => {
  const { root, client, store, server } = await fixture();
  // Nothing is written into the outline at start any more: no rule note, no script note.
  expect(store.queryBlocks({ where: "rule-name=deploy-artifact" }).blocks).toHaveLength(0);
  expect(store.queryBlocks({ where: "script=deploy-artifact" }).blocks).toHaveLength(0);
  expect((await client.request<Listed>({ action: "extensions.list" })).available?.map(a => a.id)).toContain("artifact-deploy");
  const note = await client.request<{ id: string }>({ action: "create", text: "Moth garden [artifact::ep0ch-artifacts/moth-garden]", author: "user" });
  await server.extensionRules.settle(); await Bun.sleep(100);
  expect(deployed(store)).toBeUndefined();
  // The power bar's install row: a user folder is in use, and the kit still lands in this outline's own.
  await client.request({ action: "extensions.install", extension: "artifact-deploy" });
  expect(await kitOf(client)).toMatchObject({ state: "active", origin: "outline", directory: join(root, "extensions", "artifact-deploy") });
  expect(existsSync(join(root, "user-extensions", "artifact-deploy"))).toBe(false);
  await save(client, store, note.id, "Moth garden [artifact::ep0ch-artifacts/moth-garden]\nsown");
  await server.extensionRules.settle();
  expect(await until(() => deployed(store) === "abc123")).toBe(true);
  // The kit's script ran on the saved note (`this`): the deploy wrote its URL there.
  expect(await until(() => store.get(note.id)!.text.includes("[url::"))).toBe(true);
  await client.request({ action: "extensions.uninstall", extension: "artifact-deploy", demo: "keep" });
  expect(await kitOf(client)).toBeUndefined();
  writeFileSync(join(root, "commit"), "def456");
  await save(client, store, note.id, `${store.get(note.id)!.text}\nthinned`);
  await server.extensionRules.settle(); await Bun.sleep(100);
  expect(deployed(store)).toBe("abc123");
});

test("an outline with the old seeded notes lists the kit as installed, keeps deploying on save, and never gets them back", async () => {
  let seeded: Awaited<ReturnType<typeof seedOld>> | undefined;
  const { root, client, store, server, paths } = await fixture(false, { before: async (s) => { seeded = await seedOld(s); } });
  // Installed in the outline's own folder, as the power bar's row would: removable from here alone.
  expect(await kitOf(client)).toMatchObject({ state: "active", origin: "outline", directory: join(root, "extensions", "artifact-deploy") });
  // The two notes did what the kit does now: they're in Trash, by the extension, and the key is spent.
  expect(store.get(seeded!.rule.id)!.effectiveDeletedRootId).toBe(seeded!.rule.id);
  expect(store.get(seeded!.script.id)!.effectiveDeletedRootId).toBe(seeded!.script.id);
  expect(store.readMetadata("artifacts.deploy-rule")).toBe("");
  const note = await client.request<{ id: string }>({ action: "create", text: "Lamp yard\n\n[artifact::ep0ch-artifacts/moth-garden]", author: "user" });
  await server.extensionRules.settle();
  expect(await until(() => deployed(store) === "abc123")).toBe(true);
  // Uninstalled here, a restart doesn't bring the notes or the kit back.
  await client.request({ action: "extensions.uninstall", extension: "artifact-deploy", demo: "keep" });
  await server.extensionRules.settle(); await server.close();
  const again = new OutlinerServer(store, paths.socket, undefined, undefined, { outlinesFolder: paths.outlines, ruleQuietMs: 20 });
  await again.start();
  cleanup.push(async () => { await again.extensionRules.settle(); await again.close(); });
  expect(await kitOf(new OutlinerClient(paths.socket))).toBeUndefined();
  expect(store.queryBlocks({ where: "rule-name=deploy-artifact" }).blocks).toHaveLength(0);
  expect(store.get(note.id)!.effectiveDeletedRootId).toBeFalsy();
});

test("seeded notes someone edited stay their own rule: kept as written, and the kit isn't installed over them", async () => {
  let seeded: Awaited<ReturnType<typeof seedOld>> | undefined;
  const { client, store } = await fixture(false, { before: async (s) => { seeded = await seedOld(s, (action) => seededRule(action, " [rule-quiet::30s]", "Mine now.")); } });
  expect(store.get(seeded!.rule.id)!.text).toContain("Mine now.");
  expect(store.get(seeded!.rule.id)!.effectiveDeletedRootId).toBeFalsy();
  // Its script nobody edited still reads lines (PIE-1060).
  expect(store.get(seeded!.script.id)!.text).toContain("tools.artifact_deploy({ note: this.id })");
  expect(await kitOf(client)).toBeUndefined();
});
