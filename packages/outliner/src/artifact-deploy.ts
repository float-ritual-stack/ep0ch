import { scriptSourceId } from "./script-sources";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { patchPropertyText } from "./properties";
import type { ArtifactStore } from "./artifact-store";
import type { OutlinerStore } from "./store";
import type { MutationProvenance } from "./types";

export interface Deployment {
  name: string; repo: string; where: "float-2" | "vercel"; url: string;
  commit: string; contentHash?: string; deployedAt: string; reason: string;
}

function artifactRepo(input: string): { name: string; repo: string; url: string } {
  const raw = input.replace(/^https:\/\//, "").replace(/^github\.com\//, "").replace(/\.git$/, "");
  const parts = raw.split("/");
  const [owner, name] = parts.length === 1 ? ["ep0ch-artifacts", parts[0]!] : parts;
  if (parts.length > 2 || !owner || !name || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
    throw new Error("Use ep0ch artifact deploy ep0ch-artifacts/<repo>.");
  const url = `https://github.com/${owner}/${name}`;
  if (owner !== "ep0ch-artifacts") throw new Error(`Only ep0ch-artifacts repos can deploy. Run:\ngh repo fork ${url} --org ep0ch-artifacts\ngh api -X POST repos/${owner}/${name}/transfer -f new_owner=ep0ch-artifacts`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("The repo name must also be a DNS label: lower-case letters, digits and hyphens.");
  return { name, repo: `${owner}/${name}`, url };
}

export function artifactDestination(files: readonly string[], pkg?: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): Pick<Deployment, "where" | "reason"> {
  if (pkg?.scripts?.build) return { where: "vercel", reason: "package.json has a build script" };
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const framework = ["next", "vite", "@sveltejs/kit"].find(key => deps[key]);
  if (framework) return { where: "vercel", reason: `package.json uses ${framework}` };
  if (files.some(file => /^(?:src\/)?(?:api\/|pages\/api\/|app\/(?:.+\/)?route\.[cm]?[jt]s$|routes\/(?:.+\/)?\+server\.[jt]s$)/.test(file))) return { where: "vercel", reason: "the repo has API routes" };
  if (pkg?.scripts?.start) return { where: "vercel", reason: "package.json has a server start script" };
  return { where: "float-2", reason: "no build script, server or app framework; serve the files from the artifact store" };
}

type Program = "git" | "gh" | "vercel" | "hcloud" | "with-secrets";
async function artifactProgram(program: Program, args: string[], cwd?: string, secretGroup?: string): Promise<string> {
  const path = (name: Program) => process.env[`EP0CH_${name.toUpperCase().replaceAll("-", "_")}`] ?? name;
  const command = secretGroup ? [path("with-secrets"), secretGroup, "--", path(program), ...args] : [path(program), ...args];
  let child;
  try { child = Bun.spawn(command, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdout: "pipe", stderr: "pipe" }); }
  catch { throw new Error(`Cannot start ${program}; install it on the outline host and run ep0ch artifact deploy again.`); }
  // External diagnostics can contain credentials. Keep them out of notes and socket replies.
  const [out, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${program} ${args[0] ?? ""} exited ${code}; check its login on the outline host and run the artifact command again.`);
  return out.trimEnd();
}

export async function artifactDns(name: string, to: "vercel" | "float-2") {
  if (artifactRepo(name).name !== name) throw new Error("Use a bare name: ep0ch artifact dns <name> --to vercel|float-2.");
  if (to !== "vercel" && to !== "float-2") throw new Error("Use ep0ch artifact dns <name> --to vercel|float-2.");
  const type = to === "vercel" ? "CNAME" : "A", value = to === "vercel" ? "cname.vercel-dns.com." : "2.28.99.29";
  const record = `${name}.ep0ch.sh. 300 IN ${type} ${value}`;
  const groups = await artifactProgram("with-secrets", ["--list"]);
  if (!groups.split(/\s+/).includes("hetzner-dns")) return { outcome: "manual", record, said: `No hetzner-dns secrets group. Add this record by hand: ${record}. Run with-secrets --add hetzner-dns HCLOUD_TOKEN to store a token with DNS rights, then run ep0ch artifact dns ${name} --to ${to}.` };
  const rrsets = JSON.parse(await artifactProgram("hcloud", ["zone", "rrset", "list", "ep0ch.sh", "-o", "json"], undefined, "hetzner-dns")) as { name: string; type: string; records: { value: string }[] }[];
  const same = rrsets.find(r => r.name === name && r.type === type);
  if (same?.records.length === 1 && same.records[0]!.value === value) return { outcome: "up-to-date", record };
  for (const conflict of rrsets.filter(r => r.name === name && (type === "CNAME" || r.type === "CNAME") && r.type !== type))
    await artifactProgram("hcloud", ["zone", "rrset", "delete", "ep0ch.sh", name, conflict.type], undefined, "hetzner-dns");
  await artifactProgram("hcloud", same
    ? ["zone", "rrset", "set-records", "ep0ch.sh", name, type, "--record", value]
    : ["zone", "rrset", "create", "ep0ch.sh", "--name", name, "--type", type, "--ttl", "300", "--record", value], undefined, "hetzner-dns");
  return { outcome: "updated", record };
}

export function deployedArtifacts(artifacts: ArtifactStore): Deployment[] {
  const path = join(artifacts.root, "deployments.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}
function rememberDeployment(artifacts: ArtifactStore, deployment: Deployment) {
  const all = deployedArtifacts(artifacts).filter(row => row.name !== deployment.name);
  mkdirSync(artifacts.root, { recursive: true });
  const file = join(artifacts.root, "deployments.json");
  writeFileSync(`${file}.tmp`, JSON.stringify([...all, deployment]));
  renameSync(`${file}.tmp`, file);
}

const queues = new Map<string, Promise<unknown>>();
export function deployArtifact(artifacts: ArtifactStore, store: OutlinerStore, input: string, requestedBy?: MutationProvenance) {
  const repo = artifactRepo(input);
  const previous = queues.get(artifacts.root) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => deploy(artifacts, store, repo, requestedBy)).catch(error => {
    const actor = { author: "agent" as const, actorId: "ext:artifact-deploy" };
    store.changes.run(store.changes.attribution({ action: "artifacts.deploy", actor, requestedBy }), () =>
      store.create(`Artifact ${repo.name}: failed [type::artifact-run] [status::failed]\n\nRepo: ${repo.repo}\n${error.message}\nRun ep0ch artifact deploy ${repo.repo} again after fixing the problem.`, null, "agent", actor));
    throw error;
  });
  queues.set(artifacts.root, run);
  void run.finally(() => { if (queues.get(artifacts.root) === run) queues.delete(artifacts.root); }).catch(() => {});
  return run;
}
async function deploy(artifacts: ArtifactStore, store: OutlinerStore, repo: ReturnType<typeof artifactRepo>, requestedBy?: MutationProvenance) {
  const parent = process.env.EP0CH_ARTIFACT_DEPLOYS ?? join(homedir(), "artifact-deploys");
  mkdirSync(parent, { recursive: true });
  const folder = join(parent, repo.name);
  if (!existsSync(folder)) await artifactProgram("git", ["clone", repo.url, folder]);
  else {
    const remote = await artifactProgram("git", ["remote", "get-url", "origin"], folder);
    if (remote !== repo.url && remote !== `${repo.url}.git`) throw new Error(`The clone ${folder} has another origin; move it aside and run ep0ch artifact deploy ${repo.repo} again.`);
    await artifactProgram("git", ["fetch", "origin"], folder);
    await artifactProgram("git", ["reset", "--hard", "origin/HEAD"], folder);
  }
  const commit = await artifactProgram("git", ["rev-parse", "HEAD"], folder);
  const files = (await artifactProgram("git", ["ls-files", "-z"], folder)).split("\0").filter(Boolean);
  const pkg = files.includes("package.json") ? JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) : undefined;
  const choice = artifactDestination(files, pkg);
  let deployment = deployedArtifacts(artifacts).find(row => row.name === repo.name && row.commit === commit && row.where === choice.where);
  const remoteExists = choice.where === "vercel" && (await vercelDeployments(commit)).some(d => d.name === repo.name && d.state === "READY");
  let unchanged = !!deployment && (choice.where === "vercel" ? remoteExists : existsSync(join(artifacts.live, repo.name)) && deployment.contentHash === artifacts.contentHash(repo.name));
  let dns: Awaited<ReturnType<typeof artifactDns>> | undefined;
  if (!unchanged) {
    if (choice.where === "float-2") {
      const publish = files.filter(file => !file.split("/").some(part => part.startsWith(".")) && !/^(?:README(?:\..*)?|LICENSE(?:\..*)?|package(?:-lock)?\.json|bun\.lock[b]?|yarn\.lock|pnpm-lock\.yaml)$/i.test(file));
      const contents = Object.fromEntries(publish.map(file => {
        if (lstatSync(join(folder, file)).isSymbolicLink()) throw new Error(`Artifact refuses symlink ${file}.`);
        return [file, readFileSync(join(folder, file))];
      }));
      await artifacts.put(repo.name, contents, { compile: true, rejectErrors: true });
    } else {
      const scope = ["--scope", "e-schultz"];
      unchanged = remoteExists;
      if (!unchanged) {
        await artifactProgram("vercel", ["link", "--yes", "--project", repo.name, ...scope], folder);
        await artifactProgram("vercel", ["deploy", "--prod", "--yes", "--meta", `ep0chCommit=${commit}`, ...scope], folder);
      }
      await artifactProgram("vercel", ["domains", "add", `${repo.name}.ep0ch.sh`, repo.name, ...scope], folder);
      dns = await artifactDns(repo.name, "vercel");
    }
    deployment = { ...repo, ...choice, commit, deployedAt: new Date().toISOString(), url: choice.where === "float-2" ? `https://artifacts.ep0ch.sh/${repo.name}/` : `https://${repo.name}.ep0ch.sh` };
    if (choice.where === "float-2") deployment.contentHash = artifacts.contentHash(repo.name);
    rememberDeployment(artifacts, deployment);
  }
  const outcome = unchanged ? "up-to-date" : "deployed";
  registerArtifact(store, deployment!, requestedBy);
  const actor = { author: "agent" as const, actorId: "ext:artifact-deploy" };
  const run = store.changes.run(store.changes.attribution({ action: "artifacts.deploy", actor, requestedBy }), () =>
    store.create(`Artifact ${repo.name}: ${outcome} [type::artifact-run]\n\nCommit: ${commit}\nWhere: ${choice.where}\nURL: ${deployment!.url}\nWhy: ${choice.reason}\n${unchanged ? "Up to date, nothing done." : "Deployed."}${dns ? `\nDNS: ${dns.record} (${dns.outcome})${"said" in dns ? `\n${dns.said}` : ""}` : ""}`, null, "agent", actor));
  return { ...deployment!, outcome, run: run.id, ...(dns ? { dns } : {}) };
}

function registerArtifact(store: OutlinerStore, row: Deployment, requestedBy?: MutationProvenance) {
  const actor = { author: "agent" as const, actorId: "ext:artifact-deploy" };
  return store.changes.run(store.changes.attribution({ action: "artifacts.register", actor, requestedBy }), () => store.inTransaction(() => {
    const found = store.lookupBlockRef("[[artifacts]]");
    const remembered = store.readMetadata("artifacts.catalogue");
    const catalogue = (remembered ? store.get(remembered) : null) ?? (found.kind === "found" ? found.block : store.create("Artifacts [page::artifacts]\n\nDeployed artifacts and their source commits.", null, "agent", actor));
    const text = `${row.name} [type::artifact-deployment] [url::${row.url}] [repo::${row.repo}] [where::${row.where}] [deployed-at::${row.deployedAt}] [commit::${row.commit}]\n\n${row.reason}`;
    const old = store.children(catalogue.id).find(b => b.properties.some(p => p.key === "repo" && p.value === row.repo) && b.text.startsWith(`${row.name} `));
    if (!old) store.create(text, catalogue.id, "agent", actor);
    else if (old.text !== text) store.update(old.id, text, old.revision, actor);
    for (const note of store.queryBlocks({ filters: [{ key: "artifact" }], limit: 1000 }).blocks) {
      const tokens = parsePropertyRecords(note.text);
      const source = tokens.find(p => p.key === "artifact" && p.scope === "block");
      if (!source) continue;
      let match = false;
      try { match = artifactRepo(source.value).repo === row.repo; } catch { continue; }
      if (!match) continue;
      const url = tokens.findIndex(p => p.key === "url" && p.scope === "block");
      const patched = patchPropertyText(note.text, [url < 0 ? { op: "append", key: "url", value: row.url } : { op: "replace", ordinal: url, key: "url", value: row.url }]);
      if (patched !== note.text) store.update(note.id, patched, note.revision, actor);
    }
    return catalogue.id;
  }));
}

export async function backfillArtifacts(artifacts: ArtifactStore, store: OutlinerStore, catalogue?: string) {
  if (catalogue) store.writeMetadata("artifacts.catalogue", store.resolveBlockRef(catalogue).id);
  const repos = JSON.parse(await artifactProgram("gh", ["repo", "list", "ep0ch-artifacts", "--json", "name,url,homepageUrl", "--limit", "100"])) as { name: string; url: string; homepageUrl: string }[];
  const domains = ["kalku-run", "plastik-kraft", "plastik-loop", "ansi-culture", "kalku-path", "goose"];
  const imported: Deployment[] = [];
  const pending: string[] = [];
  for (const name of [...new Set([...domains, ...repos.map(r => r.name)])]) {
    const repo = repos.find(r => r.name === name);
    if (repo && imported.some(row => row.repo === `ep0ch-artifacts/${repo.name}`)) continue;
    let url = domains.includes(name) ? `https://${name}.ep0ch.sh` : repo?.homepageUrl;
    if (!url) {
      const list = await vercelDeployments();
      const live = list.find(d => d.name === name && d.state === "READY");
      if (live) url = `https://${live.url}`;
    }
    if (!url) { pending.push(`${name}: no current deployed URL; not deployed by backfill`); continue; }
    const inspected = JSON.parse(await artifactProgram("vercel", ["inspect", url, "--json", "--scope", "e-schultz"])) as { id: string };
    const info = JSON.parse(await artifactProgram("vercel", ["api", `/v13/deployments/${encodeURIComponent(inspected.id)}`, "--scope", "e-schultz"])) as { meta?: { githubCommitOrg?: string; githubCommitRepo?: string; githubCommitSha?: string; ep0chCommit?: string }; createdAt: number };
    const row: Deployment = { name, url, repo: info.meta?.githubCommitOrg && info.meta.githubCommitRepo ? `${info.meta.githubCommitOrg}/${info.meta.githubCommitRepo}` : repo ? `ep0ch-artifacts/${repo.name}` : "unknown", where: "vercel", commit: info.meta?.ep0chCommit ?? info.meta?.githubCommitSha ?? "unknown", deployedAt: new Date(info.createdAt).toISOString(), reason: "Imported the existing deployment; no redeploy." };
    rememberDeployment(artifacts, row); registerArtifact(store, row); imported.push(row);
  }
  return { imported, pending };
}

export function seedArtifactRule(store: OutlinerStore) {
  if (store.readMetadata("artifacts.deploy-rule")) return;
  const actor = { actorId: "ext:artifact-deploy" };
  const script = store.create('Deploy the repo named by this note [script::deploy-artifact] [effects::write] [deadline::5m]\n\n```js\nconst repo = this.properties.find(p => p.key === "artifact");\nif (repo?.values[0]?.includes("/")) text(await tools.artifact_deploy({ repo: repo.values[0] }));\n```', null, "agent", actor);
  const action = `${scriptSourceId(script.id)}/run`;
  const rule = store.create(`Deploy repos named by notes [rule-name::deploy-artifact] [rule-match::artifact] [rule-on::${action}] [rule-on-change::${action}]\n\nOnly ep0ch-artifacts repos deploy. The repo decides the destination; remove this rule to stop automatic deployment.`, null, "agent", actor);
  store.writeMetadata("artifacts.deploy-rule", rule.id);
}

interface VercelDeployment { name: string; url: string; state: string }
async function vercelDeployments(commit?: string): Promise<VercelDeployment[]> {
  const filters = commit ? [["--meta", `ep0chCommit=${commit}`], ["--meta", `githubCommitSha=${commit}`]] : [[]];
  const deployments: VercelDeployment[] = [];
  for (const filter of filters) {
    const result = JSON.parse(await artifactProgram("vercel", ["list", "--all", "--prod", "--json", "--limit", "100", ...filter, "--scope", "e-schultz"])) as { deployments: VercelDeployment[] };
    deployments.push(...result.deployments);
  }
  return deployments;
}
