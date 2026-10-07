// `ep0ch install`'s plan: from the facts (model.ts), which steps run, in order, and which are already current.
// Pure: the dry run prints it, `--apply` runs it (apply.ts), the tests check it against described machines.
//
// One checkout (the ep0ch repo) is fast-forwarded, its workspace installed, `ep0ch` linked, the Herdr plugin
// checked to be that checkout's packages/outliner, and the outline host restarted through its unit when the code
// under it changed. Every `<outlines>/*.sqlite` is backed up first. Units and Herdr's config are never edited:
// what they need is said.
import { join, resolve } from "node:path";
import { ep0ch } from "../session/place";
import { backupPlan } from "../backup/setup";
import { linkCommands, linkCounts, type LinkWork, linkWork, type OwnedLink, type StaleLink } from "./links";
import { type Checkout, type DatabaseFacts, type Deps, type Facts, type HostUnit, KEYED_ACTIONS, type McpFacts, PLUGIN_ID, PLUGIN_SOURCE, type SessionFact, short, staleness } from "./model";

/** do: runs with --apply. skip: already current. manual: needs a person (the hint says what). */
export type StepStatus = "do" | "skip" | "manual";
export type StepId = "backup" | "repo" | "plugin" | "link" | "ext" | "skills" | "host" | "mcp" | "session" | "backups";

export interface Step {
  id: StepId;
  title: string;
  status: StepStatus;
  why: string;
  /** What it runs, as shell commands a person could type. */
  commands: string[];
  /** backup: each database and where it's copied. */
  backups?: (DatabaseFacts & { dest: string })[];
  /** A checkout whose remote couldn't be reached (the fetch failed): whether it's current isn't known. */
  unchecked?: true;
  /** ext, skills: the links to make, replace and take away (links.ts), as the commands say. */
  links?: LinkWork;
  /** backups: the files it writes (the job's units, its settings) before it loads them. */
  writes?: { path: string; text: string }[];
}

export interface Plan { steps: Step[]; notes: string[] }
export interface PlanOptions { now: Date; backupDir: string }

/** Where backups go: ~/backups/ep0ch. */
export const backupDirOf = (home: string) => join(home, "backups", "ep0ch");

/** A timestamp for file names, in UTC: 20260929T221530Z. */
export const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** `<UTC timestamp>/<name>.sqlite`: one folder per run, each outline by its name (names are unique in a folder). */
export const backupName = (name: string, now: Date) => join(stamp(now), `${name}.sqlite`);

/** The first directory, in preference order, that is on PATH and writable; null when none is. */
export function chooseLinkDir(dirs: Facts["linkDirs"]): string | null {
  return dirs.find(d => d.onPath && d.writable)?.dir ?? null;
}

/** The link directories `install` considers, in order: never one that needs sudo. */
export const linkCandidates = (home: string) => [join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];

const bunInstall = (root: string) => `(cd ${root} && bun install --frozen-lockfile)`;

/** A checkout's update: fast-forward to origin/main, then `bun install` when needed; or why a person must. */
export function checkoutStep(c: Checkout, deps: Deps | null, name: string): Pick<Step, "status" | "why" | "commands" | "unchecked"> {
  const pull = `git -C ${c.root} pull --ff-only origin main`;
  if (!c.git) return { status: "manual", why: `${c.root} isn't a git checkout`, commands: [] };
  if (!c.branch) return { status: "manual", why: `${name} has a detached HEAD; git -C ${c.root} switch main, then rerun`, commands: [] };
  if (c.branch !== "main") return { status: "manual", why: `${name} is on branch ${c.branch}, not main; git -C ${c.root} switch main, then rerun`, commands: [] };
  if (!c.upstream) return { status: "manual", why: `${name} has no origin/main to compare with (${c.fetchError ?? "no remote named origin"})`, commands: [] };
  // A real fetch failure says git's error and the command that retries it; a race with another git process
  // (fetchRaced) isn't one: that process wrote origin/main, and it's used.
  const fetched = c.fetchError ? ` (as of the last fetch; this one failed: ${c.fetchError}; retry: git -C ${c.root} fetch origin main)` : c.fetchRaced ? " (the fetch raced another git process; used the ref it wrote)" : "";
  if (c.ahead > 0 && c.behind > 0) return { status: "manual", why: `${name} has diverged: ${c.ahead} ahead and ${c.behind} behind origin/main; merge or rebase by hand${fetched}`, commands: [] };
  if (c.behind > 0 && c.dirty) return { status: "manual", why: `${name} is ${c.behind} behind origin/main but has local changes; commit or stash them (git -C ${c.root} status), then rerun`, commands: [] };
  if (c.behind > 0) {
    return { status: "do", why: `${c.behind} commit${c.behind === 1 ? "" : "s"} behind origin/main (${short(c.head)} → ${short(c.upstream)})${fetched}`,
      commands: [pull, `${bunInstall(c.root)}   # when the pull changes what's installed`] };
  }
  if (deps?.needed) return { status: "do", why: `current with origin/main${fetched}, but ${deps.why}`, commands: [bunInstall(c.root)] };
  // Never "current" on an old fetch: origin/main may have moved on since, so it's left as it is, and said.
  if (c.fetchError) {
    return { status: "manual", unchecked: true, commands: [],
      why: `couldn't check against origin/main: git fetch failed (${c.fetchError}), so ${name} wasn't updated; the last fetch had it at ${short(c.head)}. Check the network (git -C ${c.root} fetch origin main), then rerun` };
  }
  return { status: "skip", why: `current at ${short(c.head)}${c.ahead ? `, ${c.ahead} ahead of origin/main` : " (origin/main)"}`, commands: [] };
}

/** The ep0ch checkout: the door, the outliner (the plugin and the host) and outline-core, updated together. */
export function repoStep(f: Facts): Step {
  return { id: "repo", title: "Update the ep0ch checkout", ...checkoutStep(f.repo.checkout, f.repo.deps, "the ep0ch checkout") };
}

/** The commands that point Herdr's plugin at this checkout's packages/outliner. */
export const relinkCommands = (f: Facts) => [`herdr plugin unlink ${PLUGIN_ID}`, `herdr plugin link ${f.repo.outliner} --enabled`];

/**
 * The Herdr plugin: linked to this checkout's packages/outliner (the repo step updates it), or a managed install
 * of float-ritual-stack/ep0ch/packages/outliner compared with main. A link to another checkout (the old
 * pi-herdr-outliner) is the person's to relink: Herdr's registry is never edited by install.
 */
export function pluginStep(f: Facts): Step {
  const title = "The Outliner plugin in Herdr";
  const p = f.plugin;
  if (!f.herdr.path) return { id: "plugin", title, status: "manual", why: "Herdr isn't installed; install it (https://herdr.dev), then link the plugin:", commands: [`herdr plugin link ${f.repo.outliner} --enabled`] };
  if (!p) return { id: "plugin", title, status: "manual", why: "the Outliner plugin isn't in Herdr; link it to this checkout (its install.sh also binds keys and the Claude mod):", commands: [`herdr plugin link ${f.repo.outliner} --enabled`] };
  if (p.kind === "local") {
    if (resolve(p.root) === resolve(f.repo.outliner)) return { id: "plugin", title, status: "skip", why: `linked to ${p.root}: updated with the ep0ch checkout`, commands: [] };
    return { id: "plugin", title, status: "manual", why: `Herdr runs the plugin from ${p.root}, not this checkout's ${f.repo.outliner}; point Herdr at it (then restart the Outliner's panes):`, commands: relinkCommands(f) };
  }
  const recorded = p.source?.owner && p.source.repo ? `${p.source.owner}/${p.source.repo}` : null;
  if (recorded && recorded !== "float-ritual-stack/ep0ch") {
    return { id: "plugin", title, status: "manual", why: `a managed install of ${recorded}, from before the one repo; reinstall it from ${PLUGIN_SOURCE}, or link this checkout:`,
      commands: [`herdr plugin install ${PLUGIN_SOURCE} --ref main --yes`, ...relinkCommands(f)] };
  }
  // Compared with main, and refreshed from main, whatever ref it was installed from (a PR branch, a commit).
  const reinstall = `herdr plugin install ${PLUGIN_SOURCE} --ref main --yes`;
  const managed = `${title} (managed by Herdr)`;
  const from = p.source?.ref && p.source.ref !== "main" ? `; installed from ${p.source.ref}, refreshed from main` : "";
  if (!p.remote?.commit || !p.source?.commit) {
    return { id: "plugin", title: managed, status: "manual",
      why: `managed, cannot compare (${!p.source?.commit ? "Herdr recorded no installed commit" : p.remote?.error ?? "the source couldn't be reached"}); to refresh it anyway:`, commands: [reinstall] };
  }
  if (p.remote.commit === p.source.commit) return { id: "plugin", title: managed, status: "skip", why: `current at ${short(p.source.commit)} (${PLUGIN_SOURCE}@main)`, commands: [] };
  return { id: "plugin", title: managed, status: "do", why: `installed ${short(p.source.commit)}, main is at ${short(p.remote.commit)}${from}; Herdr has no update command, so installing again refreshes it`, commands: [reinstall] };
}

/** Whether a path is some ep0ch checkout's entry point (another checkout's link is left alone). */
const isDoorEntry = (target: string | null) => !!target && /\/src\/main\.ts$/.test(target);

export function linkStep(f: Facts): Step {
  const title = "Put ep0ch on PATH";
  const entry = f.repo.entry;
  if (f.ep0ch.pointsHere) return { id: "link", title, status: "skip", why: `${f.ep0ch.found} → ${entry}`, commands: [] };
  const dir = chooseLinkDir(f.linkDirs);
  if (f.ep0ch.found) {
    // Another checkout's link (the old ep0ch-door's, say) is replaced only when it's in a directory install links in.
    const relink = dir && f.ep0ch.found === join(dir, "ep0ch") && f.linkDirs.find(d => d.dir === dir)?.existing === "link";
    if (isDoorEntry(f.ep0ch.target) && relink) return { id: "link", title, status: "do", why: `${f.ep0ch.found} runs ${f.ep0ch.target}; point it at this checkout`, commands: [`ln -sfn ${entry} ${f.ep0ch.found}`] };
    return isDoorEntry(f.ep0ch.target)
      ? { id: "link", title, status: "manual", why: `ep0ch (${f.ep0ch.found}) runs another checkout, ${f.ep0ch.target}; point it here: ln -sfn ${entry} ${f.ep0ch.found}`, commands: [] }
      : { id: "link", title, status: "manual", why: `${f.ep0ch.found} is on PATH and isn't an ep0ch checkout's link; remove or rename it, then rerun`, commands: [] };
  }
  if (!dir) {
    return { id: "link", title, status: "manual",
      why: `none of ${f.linkDirs.map(d => d.dir).join(", ")} is both on PATH and writable (install never uses sudo); mkdir -p ~/.local/bin, add it to PATH, then rerun`, commands: [] };
  }
  const existing = f.linkDirs.find(d => d.dir === dir)?.existing;
  if (existing === "broken-link") return { id: "link", title, status: "do", why: `replace the broken link ${dir}/ep0ch (the first writable PATH directory)`, commands: [`ln -sfn ${entry} ${dir}/ep0ch`] };
  if (existing) return { id: "link", title, status: "manual", why: `${dir}/ep0ch exists but doesn't run (not executable?); remove it, then rerun`, commands: [] };
  return { id: "link", title, status: "do", why: `${dir} is the first writable PATH directory of ${f.linkDirs.map(d => d.dir).join(", ")}`, commands: [`ln -s ${entry} ${dir}/ep0ch`] };
}

/**
 * A step for links install owns (links.ts): each one missing is made, each of another checkout's replaced, each of
 * install's own whose file is gone taken away, and what's there already and isn't install's left as it is, said.
 */
function linksStep(id: "ext" | "skills", title: string, links: readonly OwnedLink[], stale: readonly StaleLink[], roots: readonly string[], record: string | undefined, notes: string[] = []): Step {
  const { work, taken, ours } = linkWork(links, stale, roots, record);
  const said = [...(taken.length ? [`left as they are (not install's): ${taken.map(l => l.dest).join(", ")}`] : []), ...notes].join("; ");
  const counts = linkCounts(work);
  if (counts) return { id, title, status: "do", why: `${counts}${said ? `; ${said}` : ""}`, commands: linkCommands(work), links: work };
  // A file of the person's own where a link would go is theirs to keep: said each run, never a step left for them.
  return { id, title, status: "skip", why: `${ours ? `${ours} linked` : "nothing to link"}${said ? `; ${said}` : ""}`, commands: [] };
}

/** The door's extensions' links (src/setup/ext-links.ts). */
export function extStep(f: Facts): Step {
  const exts = f.ext?.exts ?? [];
  const skipped = exts.filter(e => e.problem).map(e => `${e.name}: ${e.problem}`);
  return linksStep("ext", "Link the door's extensions (packages/door/ext)", exts.flatMap(e => e.links), f.ext?.stale ?? [], f.ext ? [f.ext.root] : [], f.ext?.record,
    skipped.map(x => `not linked: ${x}`));
}

/** The shipped agent skills' links where Claude Code (and ~/.agents) finds them (src/setup/skill-links.ts). */
export function skillsStep(f: Facts): Step {
  const s = f.skills;
  return linksStep("skills", `Link the agent skills (${s?.into.join(", ") ?? "~/.claude/skills"})`, s?.links ?? [], s?.stale ?? [], s?.roots ?? [], s?.record);
}

export function backupStep(f: Facts, o: PlanOptions, anythingElse: boolean): Step {
  const title = "Back up every outline";
  if (!f.databases.length) return { id: "backup", title, status: "skip", why: `no outlines in ${f.host.folder}`, commands: [] };
  const backups = f.databases.map(d => ({ ...d, dest: join(o.backupDir, backupName(d.name, o.now)) }));
  if (!anythingElse) return { id: "backup", title, status: "skip", why: `nothing else changes, so no backup is needed (${f.databases.length} outline${f.databases.length === 1 ? "" : "s"})`, commands: [], backups };
  return { id: "backup", title, status: "do", why: `before anything changes: a consistent copy (VACUUM INTO) of each ${f.host.folder}/*.sqlite, integrity-checked, into ${join(o.backupDir, stamp(o.now))}`,
    commands: backups.map(b => `sqlite3 ${b.path} "VACUUM INTO '${b.dest}'"`), backups };
}

/** A command for the host's unit, as a person would type it: restart (or start) it through launchd or systemd. */
export function hostUnitCommand(u: HostUnit, verb: "restart" | "start"): string {
  if (u.kind === "systemd") return `systemctl --user ${verb} ${u.name}`;
  // A job launchd hasn't loaded (booted out, or never loaded since the plist was written) is bootstrapped.
  if (verb === "start" && u.state?.detail === "not loaded in launchd") return `launchctl bootstrap gui/$(id -u) ${u.path}`;
  return `launchctl kickstart${verb === "restart" ? " -k" : ""} gui/$(id -u)/${u.name}`;
}

/** The same command as argv, for install to run. */
export function hostUnitArgv(u: HostUnit, verb: "restart" | "start", uid: number): string[] {
  if (u.kind === "systemd") return ["systemctl", "--user", verb, u.name];
  if (verb === "start" && u.state?.detail === "not loaded in launchd") return ["launchctl", "bootstrap", `gui/${uid}`, u.path];
  return ["launchctl", "kickstart", ...(verb === "restart" ? ["-k"] : []), `gui/${uid}/${u.name}`];
}

/** The host-main.ts the unit should run: this checkout's. */
export const hostMainOf = (f: Facts) => join(f.repo.outliner, "src/host-main.ts");

/** The unit runs a host-main.ts that isn't this checkout's (the old pi-herdr-outliner's, say): a restart brings back that code. */
export function unitRunsElsewhere(f: Facts): string | null {
  const u = f.host.unit;
  if (!u?.program) return null;
  return resolve(u.program) === resolve(hostMainOf(f)) ? null : u.program;
}

/**
 * What the host's unit must change, in words a person applies by hand (install never edits a unit): run this
 * checkout's host-main.ts, and drop the settings the host no longer reads (outlines are found by name in
 * EP0CH_OUTLINES, default ~/outlines; every client names its outline). Null when nothing.
 */
export function unitChanges(f: Facts): string | null {
  const u = f.host.unit;
  if (!u) return null;
  const changes: string[] = [];
  const elsewhere = unitRunsElsewhere(f);
  if (elsewhere) changes.push(u.kind === "systemd"
    ? `ExecStart=<bun> ${hostMainOf(f)} and WorkingDirectory=${f.repo.outliner} (it runs ${elsewhere})`
    : `ProgramArguments to run ${hostMainOf(f)} (it runs ${elsewhere})`);
  for (const k of u.stale) changes.push(`drop ${k} (${k === "OUTLINER_STATE_DIR" ? `outlines are ${u.outlines}/<name>.sqlite; set EP0CH_OUTLINES only for another folder` : "every client names its outline"})`);
  if (!changes.length) return null;
  const reload = u.kind === "systemd" ? `systemctl --user daemon-reload && ${hostUnitCommand(u, "restart")}` : `launchctl bootout gui/$(id -u)/${u.name}; launchctl bootstrap gui/$(id -u) ${u.path}`;
  return `in ${u.path}: ${changes.join("; ")}; then ${reload}`;
}

/**
 * The outline host (one process serving every outline by name) runs this checkout's code as it was when it
 * started. After the checkout updates, or when it speaks another protocol, install restarts it through its unit
 * (launchd's kickstart -k, systemctl restart): the doors and panes on it reconnect by themselves. A host not under
 * a unit, or a unit that needs changing (another checkout's host-main.ts, settings from before PIE-530), is left
 * to the person, with the change.
 */
export function hostStep(f: Facts, codeUpdates: boolean): Step {
  const title = "Restart the outline host on the new code";
  const h = f.host, u = h.unit;
  const missing = h.running ? staleness(h, f.repo.protocol) : [];
  const after = codeUpdates ? "the ep0ch checkout is updated in this run" : missing.length ? `it runs old code (${missing.join(", ")})` : "";
  if (!u) {
    if (!h.running) return { id: "host", title: "Start the outline host", status: "manual", why: `nothing answers at ${h.socket}, and there's no ${f.platform === "macos" ? "launchd agent" : "systemd user unit"} for it; see the note below`, commands: [] };
    if (!after) return { id: "host", title, status: "skip", why: "the host runs the current code", commands: [] };
    return { id: "host", title, status: "manual", why: `${after}, and it runs outside a ${f.platform === "macos" ? "launchd agent" : "systemd user unit"}; restart that process when it's quiet`, commands: [] };
  }
  const change = unitChanges(f);
  if (change) {
    return { id: "host", title, status: "manual", why: `${u.kind} ${u.name} needs changing before a restart brings up this checkout's host: ${change}`, commands: [] };
  }
  // The socket answers but the unit's job isn't running: another process serves it (a host started by hand),
  // and starting the unit beside it would fight it for the socket.
  if (h.running && u.state?.active === false) {
    if (!after) return { id: "host", title, status: "skip", why: `the host runs the current code (not as ${u.kind} ${u.name}, which isn't running)`, commands: [] };
    return { id: "host", title, status: "manual", why: `${after}, but another process answers at ${h.socket}, not ${u.kind} ${u.name}; stop that process, then ${hostUnitCommand(u, "start")}`, commands: [] };
  }
  if (!h.running) {
    // The unit's job runs but doesn't answer (hung, or stuck starting): a start would do nothing; a restart replaces it.
    if (u.state?.active && u.state.pid) return { id: "host", title, status: "do", why: `${u.kind} ${u.name} runs (pid ${u.state.pid}) but nothing answers at ${h.socket}; ${u.kind} restarts it`, commands: [hostUnitCommand(u, "restart")] };
    return { id: "host", title: "Start the outline host", status: "do", why: `${u.kind} ${u.name} is set up but nothing answers at ${h.socket}${u.state ? ` (${u.state.detail})` : ""}`, commands: [hostUnitCommand(u, "start")] };
  }
  if (!after) return { id: "host", title, status: "skip", why: `the host runs the current code (${u.kind} ${u.name}${h.protocol ? `, protocol ${h.protocol}` : ""})`, commands: [] };
  return { id: "host", title, status: "do", why: `${after}; ${u.kind} restarts it, and every door and pane on it reconnects`, commands: [hostUnitCommand(u, "restart")] };
}

/** The command that restarts the MCP gateway's unit, as a person would type it. */
export const mcpRestartCommand = (m: McpFacts) => hostUnitCommand({ ...m.unit, outlines: "", stale: [] }, "restart");

/** Why the MCP gateway runs older code than the checkout (after this run's update), or null when it doesn't (or can't be told). */
export function mcpBehind(f: Facts, codeUpdates: boolean): string | null {
  const m = f.mcp;
  if (!m || !m.unit.state?.active) return null;
  if (codeUpdates) return "the ep0ch checkout is updated in this run";
  if (m.behind) return `it started on ${short(m.runs)}, and the checkout is at ${short(f.repo.checkout.head)} now`;
  return null;
}

/** The gateway runs this checkout's door: only then does install restart it (never another checkout's, or one it can't tell). */
export const mcpIsHere = (f: Facts) => !!f.mcp?.door && resolve(f.mcp.door) === resolve(f.repo.door);

/**
 * The remote MCP gateway (`ep0ch mcp serve --http`, its own unit: ep0ch-mcp.service on float-2) runs the door's code as
 * it was when it started, and a host on a newer protocol refuses it. When it runs this checkout's door and the checkout
 * moved under it (in this run, or since it started), install restarts it through its unit, as it does the outline
 * host. A gateway that runs another checkout (or one install can't tell), or isn't running, is left alone and said.
 */
export function mcpStep(f: Facts, codeUpdates: boolean): Step {
  const title = "Restart the MCP gateway on the new code";
  const m = f.mcp!, u = m.unit;
  if (!mcpIsHere(f)) return { id: "mcp", title, status: "skip", why: m.door ? `${u.kind} ${u.name} runs ${m.door}, not this checkout's door; run install from that checkout` : `${u.kind} ${u.name}: which checkout's door it runs can't be told from ${u.path}; restart it yourself (${mcpRestartCommand(m)})`, commands: [] };
  if (!u.state?.active) return { id: "mcp", title, status: "skip", why: `${u.kind} ${u.name} isn't running${u.state ? ` (${u.state.detail})` : ""}; install doesn't start it`, commands: [] };
  const behind = mcpBehind(f, codeUpdates);
  if (!behind && m.behind === undefined) return { id: "mcp", title, status: "skip", why: `whether ${u.kind} ${u.name} runs the current code can't be told (no start time or reflog); ${mcpRestartCommand(m)} if it doesn't`, commands: [] };
  if (!behind) return { id: "mcp", title, status: "skip", why: `the gateway runs the current code (${u.kind} ${u.name}${m.runs ? `, ${short(m.runs)}` : ""})`, commands: [] };
  return { id: "mcp", title, status: "do", why: `${behind}; ${u.kind} restarts it, and its MCP clients reconnect`, commands: [mcpRestartCommand(m)] };
}

/** Things install reports and never does: a unit to create, keys, the Claude mod. */
export function planNotes(f: Facts): string[] {
  const notes: string[] = [];
  const h = f.host;
  if (!h.unit) {
    const run = `bun ${hostMainOf(f)}`;
    notes.push(f.platform === "linux"
      ? `No systemd user unit runs the outline host for ${h.folder}; install doesn't create units. One with ExecStart=${run} (WorkingDirectory=${f.repo.outliner}, Restart=always) serves every outline there.`
      : f.platform === "macos"
        ? `No launchd agent (io.ep0ch.outliner-host) runs the outline host for ${h.folder}; install doesn't create agents. Its ProgramArguments run ${run}.`
        : `Nothing runs the outline host for ${h.folder}; run ${run} under your service manager.`);
  }
  const missingKeys = KEYED_ACTIONS.filter(a => !f.herdr.keys[a]);
  if (f.plugin && missingKeys.length) notes.push(`Herdr has no key for ${missingKeys.map(a => `${PLUGIN_ID}.${a}`).join(", ")} in ${f.herdr.configPath}; the Outliner's install.sh writes them (install doesn't edit Herdr's config).`);
  const mod = claudeModState(f);
  if (mod.status !== "ok") notes.push(`Claude mod: ${mod.detail}${mod.fix ? `; ${mod.fix}` : ""}.`);
  const old = oldMentionsAllowlist(f);
  if (old) notes.push(`Claude mod: ${old}.`);
  return notes;
}

export function hostRestartHint(f: Facts): string {
  const u = f.host.unit;
  if (u) return `ep0ch install --apply restarts it (${hostUnitCommand(u, "restart")})`;
  return "Restart the host process when it's quiet.";
}

/** Whether Claude Code loads this checkout's Claude mod: from its settings (new sessions), else this environment. */
export function claudeModState(f: Facts): { status: "ok" | "behind" | "missing"; detail: string; fix?: string } {
  const want = f.repo.claudeMod;
  if (!want) return { status: "missing", detail: `no Claude mod in ${f.repo.root}` };
  const dirs = f.claude.settingsDirs ?? f.claude.envDirs ?? [];
  const where = f.claude.settingsDirs ? f.claude.settingsPath : "CLAUDE_CODE_PLUGIN_DIRS";
  // No folder to name: each Claude session follows the outline its folder's .ep0ch names (PIE-526, PIE-530).
  const fix = f.repo.claudeModInstaller ? `bun ${f.repo.claudeModInstaller}` : undefined;
  if (dirs.includes(want)) return { status: "ok", detail: `${where} loads ${want}` };
  const other = dirs.find(d => /claude-mod\/?$/.test(d));
  if (other) return { status: "behind", detail: `${where} loads ${other}, not this checkout's ${want}`, ...(fix ? { fix } : {}) };
  return { status: "missing", detail: `${where} doesn't load ${want}`, ...(fix ? { fix } : {}) };
}

/**
 * Settings that list the mod's folders with no mode: the mod then feeds nothing anywhere (mentionsModeOf in the
 * Claude mod), since the list may be an allowlist from before folder mode. The person chooses, so it is never a
 * fix to apply: it says the ways on. Keep in step with the mod's rule.
 */
export function oldMentionsAllowlist(f: Facts): string | null {
  const m = f.claude.mentions;
  if (!f.repo.claudeModInstaller || !m?.listed || m.mode) return null;
  const installer = `bun ${f.repo.claudeModInstaller}`;
  return `${f.claude.settingsPath} lists PI_OUTLINER_MENTIONS_WORKSPACES with no mode, so the Claude mod feeds nothing anywhere. ${installer} --folder drops it, and then every folder whose .ep0ch names an outline feeds that outline; --allowlist <folder> keeps strict mode; PI_OUTLINER_MENTIONS_MODE=folder opts the listed folders out`;
}

/** How a session reads in doctor and install: `pie`, `float-hub on float-2`. */
export const sessionName = (s: SessionFact) => `${s.outline}${s.machine ? ` on ${s.machine}` : ""}`;

/**
 * One door session (PIE-418) against the checkout: handed to a new daemon on its code (`do`), or why not (`skip`).
 */
export interface SessionVerdict {
  status: "do" | "skip";
  why: string;
  /** `why` without the session's name and pid, for a line that already shows them (doctor's). */
  brief: string;
  /** do: the commit the session is handed to. */
  target?: string | null;
}

export function sessionVerdict(s: SessionFact, f: Facts, repo: Pick<Step, "status">): SessionVerdict {
  const c = f.repo.checkout, who = `${sessionName(s)} (pid ${s.pid})`;
  const verdict = (status: "do" | "skip", brief: string, target?: string | null): SessionVerdict => ({ status, why: `${who} ${brief}`, brief, ...(target !== undefined ? { target } : {}) });
  if (resolve(s.dir) !== resolve(f.repo.door)) return verdict("skip", `runs another checkout's door, ${s.dir}; run install from that one`);
  // A checkout left for the person (another branch, a detached HEAD, diverged, local changes in the way) isn't code to
  // hand the session to.
  if (repo.status === "manual" || c.branch !== "main") return verdict("skip", `stays on ${short(s.commit)}: the ep0ch checkout is left for you (not main, or not fast-forwardable)`);
  const updates = repo.status === "do" && c.behind > 0;
  const target = updates ? c.upstream : c.head;
  if (s.commit && s.commit === target) return verdict("skip", `runs the current code (${short(s.commit)})`);
  return verdict("do", `runs ${short(s.commit)}, the checkout ${updates ? "will be" : "is"} at ${short(target)}: a new daemon on that code takes it over; its ${s.programs} program${s.programs === 1 ? "" : "s"} keep running and its ${s.clients} terminal${s.clients === 1 ? "" : "s"} attach again`, target);
}

/**
 * The door sessions (PIE-418), one per outline: every daemon on older code than the checkout (after its update) is
 * handed to a new one on that code (`ep0ch session upgrade --all`): its programs keep running in the terminal host,
 * its terminals attach again.
 */
export function sessionStep(f: Facts, repo: Pick<Step, "status">): Step {
  const title = "Hand the door sessions to the new code";
  const all = f.sessions ?? [];
  if (!all.length) return { id: "session", title, status: "skip", why: "no door session runs", commands: [] };
  const verdicts = all.map(s => sessionVerdict(s, f, repo));
  const doing = verdicts.some(v => v.status === "do");
  return { id: "session", title, status: doing ? "do" : "skip", why: verdicts.map(v => v.why).join("; "), commands: doing ? [`${ep0ch()}session upgrade --all`] : [] };
}

/**
 * The restic backup job (PIE-607, src/backup/setup.ts): its units written from scripts/backup/ and loaded, and the
 * settings file naming this machine. restic and the secrets are the person's: said, with the commands.
 */
export function backupsStep(f: Facts): Step | null {
  if (!f.restic) return null;
  const p = backupPlan(f.restic);
  return { id: "backups", title: "Back up the outlines to restic every 15 minutes", status: p.status, why: p.why, commands: p.commands, ...(p.writes.length ? { writes: p.writes } : {}) };
}

/** The whole plan, in order: backup first, whenever anything after it will change something. */
export function buildPlan(f: Facts, o: PlanOptions): Plan {
  const repo = repoStep(f);
  const plugin = pluginStep(f);
  const link = linkStep(f);
  // Last: an optional link that fails never stops the host's restart or the session's upgrade.
  const ext = [...(f.ext ? [extStep(f)] : []), ...(f.skills ? [skillsStep(f)] : [])];
  const host = hostStep(f, repo.status === "do" && f.repo.checkout.behind > 0);
  // The MCP gateway after the host it talks to.
  const mcp = f.mcp ? [mcpStep(f, repo.status === "do" && f.repo.checkout.behind > 0)] : [];
  const session = sessionStep(f, repo);
  const backups = backupsStep(f);
  const backup = backupStep(f, o, [repo, plugin, link, host].some(s => s.status === "do"));
  // The session last: handed to the new code once everything under it is current.
  return { steps: [backup, repo, plugin, link, host, ...mcp, session, ...(backups ? [backups] : []), ...ext], notes: planNotes(f) };
}
