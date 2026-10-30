import { scriptSourceId } from "./script-sources";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { artifactRepoRef } from "@ep0ch/outline-core/media-line";
import type { ArtifactDeployState, ArtifactInfo } from "@ep0ch/outline-core/artifacts";
import { patchPropertyText } from "./properties";
import type { ArtifactStore } from "./artifact-store";
import type { OutlinerStore } from "./store";
import type { MutationProvenance } from "./types";

export interface Deployment {
  name: string; repo: string; where: "float-2" | "vercel" | "unknown"; url: string;
  commit: string; contentHash?: string; deployedAt: string; reason: string;
}

/** The repo `input` names (artifactRepoRef's grammar, or a bare name in ep0ch-artifacts), refused unless it may deploy. */
function artifactRepo(input: string): { name: string; repo: string; url: string } {
  const ref = artifactRepoRef(input) ?? (/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.trim()) ? artifactRepoRef(`ep0ch-artifacts/${input.trim()}`) : null);
  if (!ref) throw new Error("Use ep0ch artifact deploy ep0ch-artifacts/<repo>.");
  const { owner, name } = ref;
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
  if (program === "vercel" && process.env.EP0CH_VERCEL_SCOPE) args = [...args, "--scope", process.env.EP0CH_VERCEL_SCOPE];
  const command = secretGroup ? [path("with-secrets"), secretGroup, "--", path(program), ...args] : [path(program), ...args];
  let child;
  try { child = Bun.spawn(command, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdout: "pipe", stderr: "pipe" }); }
  catch { throw new Error(`Cannot start ${program}; install it on the outline host and run ep0ch artifact deploy again.`); }
  // External diagnostics can contain credentials. Keep them out of notes and socket replies.
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) {
    if (program === "git" && args[0] === "clone" && /could not read Username/i.test(err))
      throw new Error("Private repo clone needs GitHub credentials; run gh auth setup-git on the outline host, then run the artifact command again.");
    if (program === "vercel" && /not logged in|\b401\b|unauthorized/i.test(err))
      throw new Error("Vercel login failed; run vercel login on the outline host and run the artifact command again.");
    if (program === "vercel" && args[0] === "inspect" && /can't find the deployment|deployment.*not found/i.test(err))
      throw new Error("no Vercel deployment for that domain");
    throw new Error(`${program} ${args[0] ?? ""} exited ${code}; check its login on the outline host and run the artifact command again.`);
  }
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
/** How many runs are queued or under way per repo, by artifact root: what the card says is deploying. */
const deploying = new Map<string, Map<string, number>>();
const DEPLOY_ACTOR = { author: "agent" as const, actorId: "ext:artifact-deploy" };
/** A failed run note's reason line: what the card reads back as why it stopped. */
const STOPPED = "Stopped: ";

export function deployArtifact(artifacts: ArtifactStore, store: OutlinerStore, input: string, requestedBy?: MutationProvenance, domain?: string) {
  const repo = artifactRepo(input);
  const previous = queues.get(artifacts.root) ?? Promise.resolve();
  const inFlight = deploying.get(artifacts.root) ?? new Map<string, number>();
  deploying.set(artifacts.root, inFlight.set(repo.repo, (inFlight.get(repo.repo) ?? 0) + 1));
  const run = previous.catch(() => {}).then(() => deploy(artifacts, store, repo, requestedBy, domain)).catch(error => {
    store.changes.run(store.changes.attribution({ action: "artifacts.deploy", actor: DEPLOY_ACTOR, requestedBy }), () =>
      store.create(`Artifact ${repo.name}: failed [type::artifact-run] [repo::${repo.repo}] [status::failed]\n\n${STOPPED}${error.message.split("\n").join(" · ")}\nRun ep0ch artifact deploy ${repo.repo} again after fixing the problem.`, catalogueOf(store).id, "agent", DEPLOY_ACTOR));
    throw error;
  }).finally(() => { const left = (inFlight.get(repo.repo) ?? 1) - 1; if (left > 0) inFlight.set(repo.repo, left); else inFlight.delete(repo.repo); });
  queues.set(artifacts.root, run);
  void run.finally(() => { if (queues.get(artifacts.root) === run) queues.delete(artifacts.root); }).catch(() => {});
  return run;
}

/**
 * Deploy every ep0ch-artifacts repo the note `id` names on an `[artifact::]`, on its header or a line of its own (the
 * deploy rule's script, PIE-1060). A repo another owner holds is left alone and said, with the command that forks it.
 */
export async function deployNote(artifacts: ArtifactStore, store: OutlinerStore, id: string, requestedBy?: MutationProvenance) {
  const note = store.resolveBlockRef(id);
  const tokens = parsePropertyRecords(note.text);
  const domain = tokens.find(p => p.key === "domain" && p.scope === "block")?.value;
  const repos = [...new Set(tokens.filter(p => p.key === "artifact").map(p => artifactRepoRef(p.value)?.repo).filter((r): r is string => !!r))];
  const runs: unknown[] = [];
  for (const repo of repos) {
    try { runs.push(await deployArtifact(artifacts, store, repo, requestedBy, domain)); }
    catch (error) { runs.push({ repo, outcome: "failed", said: (error as Error).message }); }
  }
  return { note: note.id, runs, ...(repos.length ? {} : { said: "No ep0ch-artifacts repo on this note: nothing to deploy." }) };
}

/** The catalogue page ([[artifacts]]): the deployed artifacts' rows, and the runs that put them there. */
function catalogueOf(store: OutlinerStore) {
  const found = store.lookupBlockRef("[[artifacts]]");
  const remembered = store.readMetadata("artifacts.catalogue");
  return (remembered ? store.get(remembered) : null) ?? (found.kind === "found" ? found.block : store.create("Artifacts [page::artifacts]\n\nDeployed artifacts and their source commits.", null, "agent", DEPLOY_ACTOR));
}

/**
 * What the repo an artifact line names is doing (PIE-1060), answered from this file's records: the deployment record
 * (by name, so an imported deployment of a fork counts), a run under way here, and the newest run note. Undefined when
 * `value` names no repo. The card and the published page both ask `artifacts.show`, which answers this.
 */
export function artifactRepoInfo(artifacts: ArtifactStore, store: OutlinerStore, value: string): ArtifactInfo | undefined {
  const ref = artifactRepoRef(value);
  if (!ref) return undefined;
  // Its address is the live site's whatever the newest run did: a failed redeploy leaves the last one serving.
  const info = (deploy: ArtifactDeployState): ArtifactInfo => ({ name: ref.name, files: [], bytes: 0, url: deploy.url ?? null, deploy });
  try { artifactRepo(value); } catch (error) {
    const [said, ...commands] = (error as Error).message.split("\n");
    // The fork is the command to run; moving the repo instead is the message's other choice.
    return info({ repo: ref.repo, state: "refused", said: said!.replace(/\. Run:$/, ": fork it there, or move it"), ...(commands.length ? { command: commands[0] } : {}) });
  }
  const rows = deployedArtifacts(artifacts);
  const record = rows.find(row => row.repo === ref.repo && row.url !== "pending") ?? rows.find(row => row.name === ref.name && row.url !== "pending");
  const pending = rows.find(row => (row.repo === ref.repo || row.name === ref.name) && row.url === "pending");
  const runNote = store.queryBlocks({ where: `type=artifact-run repo=${ref.repo}`, sort: "created desc", limit: 1 }).blocks[0];
  const status = runNote && parsePropertyRecords(runNote.text).find(p => p.key === "status" && p.scope === "block")?.value;
  const run = runNote ? { id: runNote.id, title: runNote.text.split("\n")[0]!.replace(/\s*\[[^\]]*::[^\]]*\]/g, "").trim(), at: new Date(runNote.updatedAt ?? runNote.createdAt).toISOString() } : undefined;
  const live = record ? { url: record.url, where: record.where, commit: record.commit, deployedAt: record.deployedAt, ...(record.repo !== ref.repo ? { recorded: record.repo } : {}) } : {};
  const command = `ep0ch artifact deploy ${ref.repo}`;
  const base = { repo: ref.repo, ...live, ...(run ? { run } : {}) };
  if (deploying.get(artifacts.root)?.has(ref.repo)) return info({ ...base, state: "deploying" });
  if (status === "failed" && (!record || Date.parse(record.deployedAt) < Date.parse(run!.at) || Number.isNaN(Date.parse(record.deployedAt))))
    return info({ ...base, state: "failed", said: runNote!.text.split("\n").find(line => line.startsWith(STOPPED))?.slice(STOPPED.length) ?? "its last run failed", command });
  if (record) return info({ ...base, state: "live" });
  return info({ ...base, state: "not-deployed", ...(pending ? { said: pending.reason } : {}), command });
}
async function deploy(artifacts: ArtifactStore, store: OutlinerStore, repo: ReturnType<typeof artifactRepo>, requestedBy?: MutationProvenance, domain?: string) {
  // The note that names it, on its header or a line of its own: its header's [domain::] names the address.
  const source = store.queryBlocks({ filters: [{ key: "artifact" }], propertyScope: "all", limit: 1000 }).blocks.find(note =>
    parsePropertyRecords(note.text).some(p => p.key === "artifact" && artifactRepoRef(p.value)?.repo === repo.repo));
  domain ??= source && parsePropertyRecords(source.text).find(p => p.key === "domain" && p.scope === "block")?.value;
  if (domain) {
    domain = domain.replace(/\.ep0ch\.sh$/, "");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(domain)) throw new Error("Use --domain <name> or [domain::<name>] with an ep0ch.sh subdomain label.");
  }
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
  const target = choice.where === "vercel" ? await vercelTarget(artifacts, repo, domain) : undefined;
  const remoteExists = !!target?.exists && (await vercelDeployments(commit, target.project)).some(d => d.state === "READY");
  let unchanged = !!deployment && (!target || deployment.url === `https://${target.domain}.ep0ch.sh`) && (choice.where === "vercel" ? remoteExists : existsSync(join(artifacts.live, repo.name)) && deployment.contentHash === artifacts.contentHash(repo.name));
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
      unchanged = remoteExists && target!.assigned;
      if (!remoteExists) {
        await artifactProgram("vercel", ["link", "--yes", "--project", target!.project], folder);
        await artifactProgram("vercel", ["deploy", "--prod", "--yes", "--meta", `ep0chCommit=${commit}`], folder);
      }
      if (!target!.assigned) {
        await artifactProgram("vercel", ["domains", "add", `${target!.domain}.ep0ch.sh`, target!.project], folder);
        dns = await artifactDns(target!.domain, "vercel");
      }
    }
    deployment = { ...repo, ...choice, commit, deployedAt: new Date().toISOString(), url: choice.where === "float-2" ? `https://artifacts.ep0ch.sh/${repo.name}/` : `https://${target!.domain}.ep0ch.sh` };
    if (choice.where === "float-2") deployment.contentHash = artifacts.contentHash(repo.name);
    rememberDeployment(artifacts, deployment);
  }
  const outcome = unchanged ? "up-to-date" : "deployed";
  const catalogue = registerArtifact(store, deployment!, requestedBy);
  const text = `Artifact ${repo.name}: ${outcome} [type::artifact-run] [repo::${repo.repo}] [status::${outcome}]\n\nCommit: ${commit}\nWhere: ${choice.where}\nURL: ${deployment!.url}\nWhy: ${choice.reason}\n${unchanged ? "Up to date, nothing done." : "Deployed."}${dns ? `\nDNS: ${dns.record} (${dns.outcome})${"said" in dns ? `\n${dns.said}` : ""}` : ""}`;
  // A save that changes nothing checks again: the same answer is the newest run's, refreshed, not one more note per edit.
  const last = store.queryBlocks({ where: `type=artifact-run repo=${repo.repo}`, sort: "created desc", limit: 1 }).blocks[0];
  const run = store.changes.run(store.changes.attribution({ action: "artifacts.deploy", actor: DEPLOY_ACTOR, requestedBy }), () =>
    unchanged && last && !last.text.includes("[status::failed]") && last.text.includes(`\nCommit: ${commit}\n`) && last.text.includes(`\nURL: ${deployment!.url}\n`)
      ? store.update(last.id, `${last.text.split("\nChecked again ")[0]}\nChecked again ${new Date().toISOString()}: up to date, nothing done.`, last.revision, DEPLOY_ACTOR)
      : store.create(text, catalogue, "agent", DEPLOY_ACTOR));
  return { ...deployment!, outcome, run: run.id, ...(dns ? { dns } : {}) };
}

function registerArtifact(store: OutlinerStore, row: Deployment, requestedBy?: MutationProvenance) {
  const actor = { author: "agent" as const, actorId: "ext:artifact-deploy" };
  return store.changes.run(store.changes.attribution({ action: "artifacts.register", actor, requestedBy }), () => store.inTransaction(() => {
    const catalogue = catalogueOf(store);
    const text = `${row.name} [type::artifact-deployment] [url::${row.url}] [repo::${row.repo}] [where::${row.where}] [deployed-at::${row.deployedAt}] [commit::${row.commit}]\n\n${row.reason}`;
    const old = store.children(catalogue.id).find(b => b.properties.some(p => p.key === "repo" && p.value === row.repo) && b.text.startsWith(`${row.name} `));
    if (!old) store.create(text, catalogue.id, "agent", actor);
    else if (old.text !== text) store.update(old.id, text, old.revision, actor);
    if (row.url === "pending") return catalogue.id;
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
  const markPending = (name: string, repo: { name: string } | undefined, reason: string) => {
    const row: Deployment = { name, repo: repo ? `ep0ch-artifacts/${repo.name}` : "unknown", where: "unknown", url: "pending", commit: "unknown", deployedAt: "unknown", reason };
    rememberDeployment(artifacts, row); registerArtifact(store, row);
    pending.push(`${name}: ${reason}`);
  };
  for (const name of [...new Set([...domains, ...repos.map(r => r.name)])]) {
    const repo = repos.find(r => r.name === name);
    if (repo && imported.some(row => row.repo === `ep0ch-artifacts/${repo.name}`)) continue;
    try {
      let url = domains.includes(name) ? `https://${name}.ep0ch.sh` : repo?.homepageUrl;
      if (!url) {
        const list = await vercelDeployments();
        const live = list.find(d => d.name === name && d.state === "READY");
        if (live) url = `https://${live.url}`;
      }
      if (!url) { markPending(name, repo, "no current deployed URL; not deployed by backfill"); continue; }
      const inspected = JSON.parse(await artifactProgram("vercel", ["inspect", url, "--json"])) as { id: string };
      const info = JSON.parse(await artifactProgram("vercel", ["api", `/v13/deployments/${encodeURIComponent(inspected.id)}`])) as { meta?: { githubCommitOrg?: string; githubCommitRepo?: string; githubCommitSha?: string; ep0chCommit?: string }; createdAt: number };
      const row: Deployment = { name, url, repo: info.meta?.githubCommitOrg && info.meta.githubCommitRepo ? `${info.meta.githubCommitOrg}/${info.meta.githubCommitRepo}` : repo ? `ep0ch-artifacts/${repo.name}` : "unknown", where: "vercel", commit: info.meta?.ep0chCommit ?? info.meta?.githubCommitSha ?? "unknown", deployedAt: new Date(info.createdAt).toISOString(), reason: "Imported the existing deployment; no redeploy." };
      rememberDeployment(artifacts, row); registerArtifact(store, row); imported.push(row);
    } catch (error) {
      markPending(name, repo, (error as Error).message);
    }
  }
  const domainPending = pending.filter(item => domains.some(name => item.startsWith(`${name}: `)));
  const summary = `${domains.length} domains: ${domains.length - domainPending.length} registered, ${domainPending.length} pending${domainPending.length ? ` (${domainPending.join(", ")})` : ""}`;
  return { imported, pending, summary };
}

const DEPLOY_SCRIPT = 'Deploy the repos named by this note [script::deploy-artifact] [effects::write] [deadline::5m]\n\n```js\ntext(await tools.artifact_deploy({ note: this.id }));\n```';
/** The texts earlier versions seeded: a copy still reading one of them was never edited, and is brought up to this one. */
const EARLIER_SCRIPTS = [
  'Deploy the repo named by this note [script::deploy-artifact] [effects::write] [deadline::5m]\n\n```js\nconst repo = this.properties.find(p => p.key === "artifact");\nif (repo?.values[0]?.includes("/")) text(await tools.artifact_deploy({ repo: repo.values[0] }));\n```',
  'Deploy the repo named by this note [script::deploy-artifact] [effects::write] [deadline::5m]\n\n```js\nconst repo = this.properties.find(p => p.key === "artifact");\nif (repo?.values[0]?.includes("/")) text(await tools.artifact_deploy({ repo: repo.values[0], domain: this.properties.find(p => p.key === "domain")?.values[0] }));\n```',
];
const earlierRule = (action: string) => `Deploy repos named by notes [rule-name::deploy-artifact] [rule-match::artifact] [rule-on::${action}] [rule-on-change::${action}]\n\nOnly ep0ch-artifacts repos deploy. The repo decides the destination; remove this rule to stop automatic deployment.`;
const deployRule = (action: string) => `Deploy repos named by notes [rule-name::deploy-artifact] [rule-match::artifact] [property-scope::all] [rule-on::${action}] [rule-on-change::${action}]\n\nOnly ep0ch-artifacts repos deploy, named on the note's header or a line of its own. The repo decides the destination; remove this rule to stop automatic deployment.`;

/**
 * The deploy rule and its script, made once per outline. A copy that still reads as an earlier version seeded it (nobody
 * edited it) is brought up to this one: the first read only the header's [artifact::], so a repo on a line of its own
 * never deployed (PIE-1060). An edited copy is left as its author wrote it.
 */
export function seedArtifactRule(store: OutlinerStore) {
  const actor = { actorId: "ext:artifact-deploy" };
  const seeded = store.readMetadata("artifacts.deploy-rule");
  if (seeded) {
    const rule = store.get(seeded);
    if (!rule || rule.effectiveDeletedRootId) return;
    const action = parsePropertyRecords(rule.text).find(p => p.key === "rule-on" && p.scope === "block")?.value;
    if (!action) return;
    if (rule.text === earlierRule(action)) store.update(rule.id, deployRule(action), rule.revision, DEPLOY_ACTOR);
    const script = store.queryBlocks({ filters: [{ key: "script", value: "deploy-artifact" }], limit: 10 }).blocks
      .find(block => action === `${scriptSourceId(block.id)}/run`);
    if (script && EARLIER_SCRIPTS.includes(script.text)) store.update(script.id, DEPLOY_SCRIPT, script.revision, DEPLOY_ACTOR);
    return;
  }
  const script = store.create(DEPLOY_SCRIPT, null, "agent", actor);
  const rule = store.create(deployRule(`${scriptSourceId(script.id)}/run`), null, "agent", actor);
  store.writeMetadata("artifacts.deploy-rule", rule.id);
}

interface VercelDeployment { name: string; url: string; state: string }
async function vercelDeployments(commit?: string, project?: string): Promise<VercelDeployment[]> {
  const filters = commit ? [["--meta", `ep0chCommit=${commit}`], ["--meta", `githubCommitSha=${commit}`]] : [[]];
  const deployments: VercelDeployment[] = [];
  for (const filter of filters) {
    const result = JSON.parse(await artifactProgram("vercel", ["list", ...(project ? [project] : ["--all"]), "--prod", "--json", "--limit", "100", ...filter])) as { deployments: VercelDeployment[] };
    deployments.push(...result.deployments);
  }
  return deployments;
}

async function vercelTarget(artifacts: ArtifactStore, repo: ReturnType<typeof artifactRepo>, requested?: string) {
  // By repo, else by name: the records are keyed by name, and an imported deployment may name the repo it was forked from.
  const rows = deployedArtifacts(artifacts).filter(row => row.where === "vercel" && row.url !== "pending");
  const remembered = rows.find(row => row.repo === repo.repo) ?? rows.find(row => row.name === repo.name);
  let project = repo.name;
  let exists = false;
  if (remembered || requested) {
    try {
      const inspected = JSON.parse(await artifactProgram("vercel", ["inspect", remembered?.url ?? `https://${requested}.ep0ch.sh`, "--json"])) as { id: string };
      const info = JSON.parse(await artifactProgram("vercel", ["api", `/v13/deployments/${encodeURIComponent(inspected.id)}`])) as { name: string };
      project = info.name;
      exists = true;
    } catch (error) {
      if (remembered || (error as Error).message !== "no Vercel deployment for that domain") throw error;
    }
  }
  if (!exists) {
    let next: number | null = null;
    do {
      const page: { projects: { name: string }[]; pagination: { next: number | null } } = JSON.parse(await artifactProgram("vercel", ["project", "ls", "--json", "--limit", "100", ...(next ? ["--next", String(next)] : [])]));
      exists = page.projects.some(p => p.name === project);
      next = page.pagination.next;
    } while (!exists && next);
  }
  const domains: string[] = [];
  if (exists) {
    let next: number | null = null;
    do {
      const page: { domains: { name: string }[]; pagination: { next: number | null } } = JSON.parse(await artifactProgram("vercel", ["api", `/v9/projects/${encodeURIComponent(project)}/domains?limit=100${next ? `&until=${next}` : ""}`]));
      domains.push(...page.domains.map(d => d.name));
      next = page.pagination.next;
    } while (next);
  }
  const rememberedDomain = remembered?.url.match(/^https:\/\/([a-z0-9-]+)\.ep0ch\.sh\/?$/)?.[1];
  const domain = requested ?? domains.find(d => d.endsWith(".ep0ch.sh"))?.replace(/\.ep0ch\.sh$/, "") ?? rememberedDomain ?? repo.name;
  return { project, exists, domain, assigned: domains.includes(`${domain}.ep0ch.sh`) };
}
