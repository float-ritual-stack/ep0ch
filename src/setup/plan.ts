// `ep0ch install`'s plan: from the facts (model.ts), which steps run, in order, and which are already current.
// Pure: the dry run prints it, `--apply` runs it (apply.ts), the tests check it against described machines.
import { join } from "node:path";
import { slugOutlineName } from "../discover";
import { type Checkout, type DatabaseFacts, type Deps, type Facts, type HostUnit, KEYED_ACTIONS, PLUGIN_ID, PLUGIN_SOURCE, type ServiceFacts, short, staleness } from "./model";

/** do: runs with --apply. skip: already current. manual: needs a person (the hint says what). offer: runs with a flag. */
export type StepStatus = "do" | "skip" | "manual" | "offer";
export type StepId = "backup" | "plugin" | "door" | "link" | "restart" | "host";

export interface Step {
  id: StepId;
  title: string;
  status: StepStatus;
  why: string;
  /** What it runs, as shell commands a person could type. */
  commands: string[];
  /** backup: each database and where it's copied. */
  backups?: (DatabaseFacts & { dest: string })[];
  /** restart: the services it restarts. */
  services?: ServiceFacts[];
}

export interface Plan { steps: Step[]; notes: string[] }
export interface PlanOptions { restartServices: boolean; now: Date; backupDir: string }

/** Where backups go: ~/backups/ep0ch. */
export const backupDirOf = (home: string) => join(home, "backups", "ep0ch");

/** A timestamp for file names, in UTC: 20260929T221530Z. */
export const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** `<name>-<timestamp>.sqlite`, the name as an outline name; a second database of that name gets `-2`. */
export function backupName(name: string, now: Date, taken: Set<string> = new Set()): string {
  const base = `${slugOutlineName(name)}-${stamp(now)}`;
  let file = `${base}.sqlite`;
  for (let n = 2; taken.has(file); n++) file = `${base}-${n}.sqlite`;
  taken.add(file);
  return file;
}

/** The first directory, in preference order, that is on PATH and writable; null when none is. */
export function chooseLinkDir(dirs: Facts["linkDirs"]): string | null {
  return dirs.find(d => d.onPath && d.writable)?.dir ?? null;
}

/** The link directories `install` considers, in order: never one that needs sudo. */
export const linkCandidates = (home: string) => [join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];

const bunInstall = (root: string) => `(cd ${root} && bun install --frozen-lockfile)`;

/** A checkout's update: fast-forward to origin/main, then `bun install` when needed; or why a person must. */
export function checkoutStep(c: Checkout, deps: Deps | null, name: string): Pick<Step, "status" | "why" | "commands"> {
  const pull = `git -C ${c.root} pull --ff-only origin main`;
  if (!c.git) return { status: "manual", why: `${c.root} isn't a git checkout`, commands: [] };
  if (!c.branch) return { status: "manual", why: `${name} has a detached HEAD; git -C ${c.root} switch main, then rerun`, commands: [] };
  if (c.branch !== "main") return { status: "manual", why: `${name} is on branch ${c.branch}, not main; git -C ${c.root} switch main, then rerun`, commands: [] };
  if (!c.upstream) return { status: "manual", why: `${name} has no origin/main to compare with (${c.fetchError ?? "no remote named origin"})`, commands: [] };
  const fetched = c.fetchError ? ` (as of the last fetch; this one failed: ${c.fetchError})` : "";
  if (c.ahead > 0 && c.behind > 0) return { status: "manual", why: `${name} has diverged: ${c.ahead} ahead and ${c.behind} behind origin/main; merge or rebase by hand${fetched}`, commands: [] };
  if (c.behind > 0 && c.dirty) return { status: "manual", why: `${name} is ${c.behind} behind origin/main but has local changes; commit or stash them (git -C ${c.root} status), then rerun`, commands: [] };
  if (c.behind > 0) {
    return { status: "do", why: `${c.behind} commit${c.behind === 1 ? "" : "s"} behind origin/main (${short(c.head)} → ${short(c.upstream)})${fetched}`,
      commands: [pull, `${bunInstall(c.root)}   # when the pull changes what's installed`] };
  }
  if (deps?.needed) return { status: "do", why: `current with origin/main, but ${deps.why}`, commands: [bunInstall(c.root)] };
  return { status: "skip", why: `current at ${short(c.head)}${c.ahead ? `, ${c.ahead} ahead of origin/main` : " (origin/main)"}${fetched}`, commands: [] };
}

export function pluginStep(f: Facts): Step {
  const title = "Update the Outliner plugin";
  const p = f.plugin;
  if (!f.herdr.path) return { id: "plugin", title, status: "manual", why: "Herdr isn't installed; install it (https://herdr.dev), then the Outliner: its install.sh", commands: [] };
  if (!p) {
    return { id: "plugin", title, status: "manual", why: "the Outliner plugin isn't installed in Herdr; install it with the Outliner's installer (keys, Claude mod) or directly:",
      commands: [`herdr plugin install ${PLUGIN_SOURCE} --ref main --yes`] };
  }
  if (p.kind === "local") return { id: "plugin", title: `${title} (linked checkout)`, ...checkoutStep(p.checkout ?? missingCheckout(p.root), p.deps, "the plugin checkout") };
  const source = p.source?.owner && p.source.repo ? `${p.source.owner}/${p.source.repo}` : PLUGIN_SOURCE;
  // Compared with main, and refreshed from main, whatever ref it was installed from (a PR branch, a commit).
  const reinstall = `herdr plugin install ${source} --ref main --yes`;
  const managed = `${title} (managed by Herdr)`;
  const from = p.source?.ref && p.source.ref !== "main" ? `; installed from ${p.source.ref}, refreshed from main` : "";
  if (!p.remote?.commit || !p.source?.commit) {
    return { id: "plugin", title: managed, status: "manual",
      why: `managed, cannot compare (${!p.source?.commit ? "Herdr recorded no installed commit" : p.remote?.error ?? "the source couldn't be reached"}); to refresh it anyway:`, commands: [reinstall] };
  }
  if (p.remote.commit === p.source.commit) return { id: "plugin", title: managed, status: "skip", why: `current at ${short(p.source.commit)} (${source}@main)`, commands: [] };
  return { id: "plugin", title: managed, status: "do", why: `installed ${short(p.source.commit)}, ${source}@main is at ${short(p.remote.commit)}${from}; Herdr has no update command, so installing again refreshes it`, commands: [reinstall] };
}
const missingCheckout = (root: string): Checkout => ({ root, git: false, branch: null, head: null, upstream: null, ahead: 0, behind: 0, dirty: false });

export function doorStep(f: Facts): Step {
  return { id: "door", title: "Update the door checkout", ...checkoutStep(f.door.checkout, f.door.deps, "the door checkout") };
}

/** Whether a path is some ep0ch-door checkout's entry point (another checkout's link is left alone). */
const isDoorEntry = (target: string | null) => !!target && /\/src\/main\.ts$/.test(target);

export function linkStep(f: Facts): Step {
  const title = "Put ep0ch on PATH";
  const entry = f.door.entry;
  if (f.ep0ch.pointsHere) return { id: "link", title, status: "skip", why: `${f.ep0ch.found} → ${entry}`, commands: [] };
  if (f.ep0ch.found) {
    return isDoorEntry(f.ep0ch.target)
      ? { id: "link", title, status: "skip", why: `ep0ch (${f.ep0ch.found}) runs another door checkout, ${f.ep0ch.target}; left as it is (run install from that checkout, or remove the link to link this one)`, commands: [] }
      : { id: "link", title, status: "manual", why: `${f.ep0ch.found} is on PATH and isn't a door checkout's link; remove or rename it, then rerun`, commands: [] };
  }
  const dir = chooseLinkDir(f.linkDirs);
  if (!dir) {
    return { id: "link", title, status: "manual",
      why: `none of ${f.linkDirs.map(d => d.dir).join(", ")} is both on PATH and writable (install never uses sudo); mkdir -p ~/.local/bin, add it to PATH, then rerun`, commands: [] };
  }
  const existing = f.linkDirs.find(d => d.dir === dir)?.existing;
  if (existing === "broken-link") return { id: "link", title, status: "do", why: `replace the broken link ${dir}/ep0ch (the first writable PATH directory)`, commands: [`ln -sfn ${entry} ${dir}/ep0ch`] };
  if (existing) return { id: "link", title, status: "manual", why: `${dir}/ep0ch exists but doesn't run (not executable?); remove it, then rerun`, commands: [] };
  return { id: "link", title, status: "do", why: `${dir} is the first writable PATH directory of ${f.linkDirs.map(d => d.dir).join(", ")}`, commands: [`ln -s ${entry} ${dir}/ep0ch`] };
}

/** Per-folder services running old code, with what each is missing. */
export function staleServices(f: Facts): { service: ServiceFacts; missing: string[] }[] {
  return f.services.filter(s => s.running).map(s => ({ service: s, missing: staleness(s, f.expected, f.plugin?.protocol ?? null) })).filter(x => x.missing.length);
}

export const serviceLabel = (s: ServiceFacts) => s.name ?? s.root ?? s.stateDir;

/** The restart of one service: close its Herdr pane, then the Outliner's own launcher starts it again. */
export const restartCommands = (s: ServiceFacts, pluginRoot: string) => [
  `herdr pane close ${s.paneId}`,
  `OUTLINER_OPEN_WORKSPACE_ROOT=${s.root} bun run ${pluginRoot}/src/herdr-open.ts --mode service-only`,
];

export function restartStep(f: Facts, o: PlanOptions, pluginUpdates: boolean): Step {
  const title = "Restart per-folder services running old code";
  const stale = staleServices(f);
  const running = f.services.filter(s => s.running);
  const after = pluginUpdates ? " (checked again after the plugin update)" : "";
  if (!stale.length && !(pluginUpdates && running.length)) {
    return { id: "restart", title, status: "skip", why: running.length ? `every running service offers what the current code does (${running.map(serviceLabel).join(", ")})` : "no per-folder services are running", commands: [] };
  }
  const listed = stale.length
    ? stale.map(x => `${serviceLabel(x.service)} (missing ${x.missing.join(", ")})`).join("; ")
    : `${running.map(serviceLabel).join(", ")} may, once the plugin is updated`;
  if (!o.restartServices) {
    return { id: "restart", title, status: "offer", why: `${listed}${after}. These are working panes: pass --restart-services to restart them`, commands: [],
      services: stale.map(x => x.service) };
  }
  const targets = (stale.length ? stale.map(x => x.service) : running);
  if (!f.herdr.inside) {
    return { id: "restart", title, status: "manual", why: `${listed}; run install from a Herdr pane to restart them (the Outliner starts services only inside Herdr)`, commands: [], services: targets };
  }
  const restartable = targets.filter(s => s.paneId && s.root);
  const not = targets.filter(s => !s.paneId || !s.root);
  const root = f.plugin?.root ?? "<plugin root>";
  if (!restartable.length) {
    return { id: "restart", title, status: "manual", why: `${listed}; none was started in a Herdr pane the Outliner recorded, so stop each and reopen the Outliner in its folder`, commands: [], services: targets };
  }
  return { id: "restart", title, status: "do",
    why: `${listed}${after}${not.length ? `; not restartable here (no recorded Herdr pane): ${not.map(serviceLabel).join(", ")}` : ""}. Reopen Tree and Detail panes on them afterwards`,
    commands: restartable.flatMap(s => restartCommands(s, root)), services: restartable };
}

export function backupStep(f: Facts, o: PlanOptions, anythingElse: boolean): Step {
  const title = "Back up every local outline database";
  if (!f.databases.length) return { id: "backup", title, status: "skip", why: "no local outline databases", commands: [] };
  const taken = new Set<string>();
  const backups = f.databases.map(d => ({ ...d, dest: join(o.backupDir, backupName(d.name, o.now, taken)) }));
  if (!anythingElse) return { id: "backup", title, status: "skip", why: `nothing else changes, so no backup is needed (${f.databases.length} database${f.databases.length === 1 ? "" : "s"})`, commands: [], backups };
  return { id: "backup", title, status: "do", why: `before anything changes: a consistent copy (VACUUM INTO) of each, integrity-checked, into ${o.backupDir}`,
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

/** The unit runs a host-main.ts that isn't the installed plugin's: a restart would bring back the old code. */
export function unitRunsElsewhere(f: Facts): string | null {
  const u = f.host.unit, root = f.plugin?.root;
  if (!u?.program || !root) return null;
  return u.program === join(root, "src/host-main.ts") ? null : u.program;
}

/**
 * The outline host (one process serving every outline by name) runs the plugin's code as it was when it
 * started. After a plugin update, or when it lacks what the plugin now offers, install restarts it through
 * its unit (launchd's kickstart -k, systemctl restart): the doors and panes on it reconnect by themselves.
 * A host not under a unit, or a unit running another checkout's host-main.ts, is left to the person.
 */
export function hostStep(f: Facts, pluginUpdates: boolean): Step {
  const title = "Restart the outline host on the new code";
  const h = f.host, u = h.unit;
  const missing = h.running ? staleness(h, f.expected, f.plugin?.protocol ?? null) : [];
  const after = pluginUpdates ? "the plugin is updated in this run" : missing.length ? `it runs old code (missing ${missing.join(", ")})` : "";
  if (!u) {
    if (!h.running) return { id: "host", title, status: "skip", why: "no outline host here (per-folder services only)", commands: [] };
    if (!after) return { id: "host", title, status: "skip", why: "the host runs the current code", commands: [] };
    return { id: "host", title, status: "manual", why: `${after}, and it runs outside a ${f.platform === "macos" ? "launchd agent" : "systemd user unit"}; restart that process when it's quiet`, commands: [] };
  }
  const elsewhere = unitRunsElsewhere(f);
  if (elsewhere && (after || !h.running)) {
    return { id: "host", title, status: "manual", why: `${u.path} runs ${elsewhere}, not the installed plugin's ${join(f.plugin!.root, "src/host-main.ts")}; point the unit at it, then ${hostUnitCommand(u, "restart")}`, commands: [] };
  }
  // The socket answers but the unit's job isn't running: another process serves it (a host started by hand),
  // and starting the unit beside it would fight it for the socket.
  if (h.running && u.state?.active === false) {
    if (!after) return { id: "host", title, status: "skip", why: `the host runs the current code (not as ${u.kind} ${u.name}, which isn't running)`, commands: [] };
    return { id: "host", title, status: "manual", why: `${after}, but another process answers at ${h.socket}, not ${u.kind} ${u.name}; stop that process, then ${hostUnitCommand(u, "start")}`, commands: [] };
  }
  if (!h.running) {
    return { id: "host", title: "Start the outline host", status: "do", why: `${u.kind} ${u.name} is set up but nothing answers at ${h.socket}${u.state ? ` (${u.state.detail})` : ""}`, commands: [hostUnitCommand(u, "start")] };
  }
  if (!after) return { id: "host", title, status: "skip", why: `the host runs the current code (${u.kind} ${u.name}${h.protocol ? `, protocol ${h.protocol}` : ""})`, commands: [] };
  return { id: "host", title, status: "do", why: `${after}; ${u.kind} restarts it, and every door and pane on it reconnects`, commands: [hostUnitCommand(u, "restart")] };
}

/** Things install reports and never does: units it would have to create, keys, the Claude mod. */
export function planNotes(f: Facts): string[] {
  const notes: string[] = [];
  const h = f.host;
  if (!h.unit) {
    notes.push(h.running
      ? `The outline host runs, but not as a ${f.platform === "macos" ? "launchd agent" : f.platform === "linux" ? "systemd user unit" : "service"}; moving it to one is a separate step (install doesn't create units).`
      : `No outline host service here (per-folder services only). Moving to the outline host is a separate step; install doesn't create ${f.platform === "macos" ? "launchd" : "systemd"} units.`);
  }
  const missingKeys = KEYED_ACTIONS.filter(a => !f.herdr.keys[a]);
  if (f.plugin && missingKeys.length) notes.push(`Herdr has no key for ${missingKeys.map(a => `${PLUGIN_ID}.${a}`).join(", ")} in ${f.herdr.configPath}; the Outliner's install.sh writes them (install doesn't edit Herdr's config).`);
  const mod = claudeModState(f);
  if (mod.status !== "ok") notes.push(`Claude mod: ${mod.detail}${mod.fix ? `; ${mod.fix}` : ""}.`);
  return notes;
}
export function hostRestartHint(f: Facts): string {
  const u = f.host.unit;
  if (u) return `ep0ch install --apply restarts it (${hostUnitCommand(u, "restart")})`;
  return "Restart the host process when it's quiet.";
}

/** Whether Claude Code loads this plugin's claude-mod: from its settings (new sessions), else this environment. */
export function claudeModState(f: Facts): { status: "ok" | "behind" | "missing"; detail: string; fix?: string } {
  if (!f.plugin) return { status: "missing", detail: "no Outliner plugin, so no Claude mod" };
  const want = join(f.plugin.root, "claude-mod");
  const dirs = f.claude.settingsDirs ?? f.claude.envDirs ?? [];
  const where = f.claude.settingsDirs ? f.claude.settingsPath : "CLAUDE_CODE_PLUGIN_DIRS";
  const fix = `bun ${f.plugin.root}/scripts/install-claude-mod.ts <workspace root>`;
  if (dirs.includes(want)) return { status: "ok", detail: `${where} loads ${want}` };
  const other = dirs.find(d => /claude-mod\/?$/.test(d) && /outliner/i.test(d));
  if (other) return { status: "behind", detail: `${where} loads ${other}, not the installed plugin's ${want}`, fix };
  return { status: "missing", detail: `${where} doesn't load ${want}`, fix };
}

/** The whole plan, in order: backup first, whenever anything after it will change something. */
export function buildPlan(f: Facts, o: PlanOptions): Plan {
  const plugin = pluginStep(f);
  const door = doorStep(f);
  const link = linkStep(f);
  const restart = restartStep(f, o, plugin.status === "do");
  const host = hostStep(f, plugin.status === "do");
  const backup = backupStep(f, o, [plugin, door, link, restart, host].some(s => s.status === "do"));
  return { steps: [backup, plugin, door, link, restart, host], notes: planNotes(f) };
}
