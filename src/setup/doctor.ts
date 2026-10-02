// `ep0ch doctor`: every piece of the stack, its state (✓ current, ! behind, ✗ missing, · for information)
// and the exact command that fixes it. Read-only; built from the facts (model.ts) so tests describe machines.
import { OUTLINE_CAPABILITIES } from "../socket";
import { DOCK_TILE_ID } from "../desk/agent-env";
import { KEYED_ACTIONS, MIN_BUN, PLUGIN_ID, type Facts, short, staleness } from "./model";
import { chooseLinkDir, claudeModState, hostRestartHint, hostUnitCommand, linkStep, pluginStep, doorStep, serviceLabel, unitRunsElsewhere } from "./plan";

/** unknown: it couldn't be checked (a fetch failed), so it isn't counted as current. */
export type CheckStatus = "ok" | "behind" | "missing" | "info" | "unknown";
export interface Check { group: string; name: string; status: CheckStatus; detail: string; fix?: string }

export const MARK: Record<CheckStatus, string> = { ok: "✓", behind: "!", missing: "✗", info: "·", unknown: "?" };

/** a.b.c ≥ min.b.c */
export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(/[.-]/).map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < b.length; i++) { const x = a[i] ?? 0, y = b[i]!; if (x !== y) return x > y; }
  return true;
}

export function doctorChecks(f: Facts): Check[] {
  const out: Check[] = [];
  const add = (group: string, name: string, status: CheckStatus, detail: string, fix?: string) => out.push({ group, name, status, detail, ...(fix ? { fix } : {}) });

  // bun
  if (!f.bun.path) add("bun", "bun", "missing", "not on PATH", f.platform === "macos" ? "brew install oven-sh/bun/bun" : "curl -fsSL https://bun.sh/install | bash");
  else if (f.bun.version && !versionAtLeast(f.bun.version, MIN_BUN)) add("bun", "bun", "behind", `${f.bun.path} ${f.bun.version}; the Outliner needs ${MIN_BUN} or newer`, f.platform === "macos" && f.bun.path.startsWith("/opt/homebrew") ? "brew upgrade bun" : "bun upgrade");
  else add("bun", "bun", "ok", `${f.bun.path} ${f.bun.version ?? "(version unknown)"}`);

  // the Outliner plugin
  const plugin = pluginStep(f);
  const p = f.plugin;
  if (!p) add("plugin", PLUGIN_ID, "missing", plugin.why, plugin.commands[0]);
  else {
    // A managed install whose source couldn't be reached (ls-remote failed) isn't known to be current either.
    const unreachable = p.kind === "github" && !!p.source?.commit && !p.remote?.commit && !!p.remote?.error && p.remote.error !== "not fetched";
    const how = p.kind === "local" ? `linked checkout ${p.root}` : `managed install ${p.root}`;
    const status = plugin.status === "skip" ? "ok" : plugin.status === "do" ? "behind" : plugin.unchecked || unreachable ? "unknown" : p.kind === "github" && !p.remote?.commit ? "info" : "behind";
    const commit = p.kind === "local" ? (p.checkout?.head ? ` at ${short(p.checkout.head)}${p.checkout.branch ? ` on ${p.checkout.branch}` : ""}` : "") : p.source?.commit ? ` at ${short(p.source.commit)}` : "";
    add("plugin", "installed", status, `${how}${commit}${p.enabled ? "" : " (disabled in Herdr)"}; ${plugin.why}`, plugin.status === "skip" || plugin.unchecked ? undefined : plugin.commands.filter(c => !c.includes("# when")).join(" && ") || "ep0ch install --apply");
    add("plugin", "protocol", p.protocol === null ? "missing" : "info",
      p.protocol === null ? `couldn't read the protocol from ${p.root}/src/types.ts` : `protocol ${p.protocol}, ${p.capabilities?.length ?? 0} service capabilities`);
    const lacking = p.capabilities ? OUTLINE_CAPABILITIES.filter(c => !p.capabilities!.includes(c)) : [];
    if (lacking.length) add("plugin", "for the door", "behind", `the door uses ${lacking.join(", ")}, which the installed plugin doesn't offer`, "update the plugin: ep0ch install --apply");
  }

  // the door
  const door = doorStep(f);
  const c = f.door.checkout;
  add("door", "checkout", door.status === "skip" ? "ok" : door.unchecked ? "unknown" : "behind", `${c.root}${c.head ? ` at ${short(c.head)}${c.branch ? ` on ${c.branch}` : ""}` : ""}; ${door.why}`,
    door.status === "do" ? door.commands.filter(x => !x.includes("# when")).join(" && ") : undefined);
  add("door", "bun install", f.door.deps.needed ? "behind" : "ok", f.door.deps.why, f.door.deps.needed ? `(cd ${c.root} && bun install --frozen-lockfile)` : undefined);
  const link = linkStep(f);
  if (f.ep0ch.pointsHere) add("door", "ep0ch on PATH", "ok", `${f.ep0ch.found} → ${f.door.entry}`);
  // Another door checkout's link is left alone on purpose (install skips it too): information, not a fault.
  else if (f.ep0ch.found) add("door", "ep0ch on PATH", link.status === "skip" ? "info" : "behind", link.why);
  else add("door", "ep0ch on PATH", "missing", `not on PATH${chooseLinkDir(f.linkDirs) ? `; install links it in ${chooseLinkDir(f.linkDirs)}` : ""}`, link.commands[0] ?? link.why);

  // outline services
  const h = f.host;
  const unit = h.unit ? `${h.unit.kind} ${h.unit.name}, ${h.unit.path}${h.unit.state ? `; ${h.unit.state.detail}` : ""}` : "no service unit";
  const elsewhere = unitRunsElsewhere(f);
  if (!h.running) {
    add("services", "outline host", h.configured || h.unit ? "missing" : "info",
      h.configured || h.unit ? `set up (${unit}) but nothing answers at ${h.socket}` : `none (${h.socket}); per-folder services only`,
      h.unit ? hostUnitCommand(h.unit, "start") : undefined);
  } else {
    const missing = staleness(h, f.expected, f.plugin?.protocol ?? null);
    const names = h.outlines.map(o => `${o.name}${o.default ? "*" : ""}${o.open ? "" : " (closed)"}`).join(", ");
    // The socket answers, but the unit says its job isn't running: something else serves it (a host started by hand).
    const stray = h.unit?.state?.active === false ? `; ${h.unit.kind} isn't running it, so another process answers` : "";
    add("services", "outline host", missing.length || stray ? "behind" : "ok",
      `${h.socket} (${unit}); default ${h.defaultOutline ?? "none"}; outlines: ${names || "none"}${h.protocol ? `; protocol ${h.protocol}` : ""}${missing.length ? `; runs old code, missing ${missing.join(", ")}` : ""}${stray}`,
      missing.length ? hostRestartHint(f) : undefined);
  }
  if (h.unit && elsewhere) {
    add("services", "host unit", "behind", `${h.unit.path} runs ${elsewhere}, not the installed plugin's ${f.plugin!.root}/src/host-main.ts: a restart brings back that code`,
      `point ${h.unit.path} at ${f.plugin!.root}/src/host-main.ts, then ${hostUnitCommand(h.unit, "restart")}`);
  }
  if (!f.services.length) add("services", "per-folder", "info", "no per-folder services on this machine");
  for (const s of f.services) {
    const label = `folder ${serviceLabel(s)}`;
    const hosted = s.database ? f.databases.find(d => d.from === "host" && d.path === s.database) : undefined;
    if (!s.running) { add("services", label, "info", hosted ? `served by the outline host as ${hosted.name} (${s.stateDir})` : `stopped (${s.stateDir})`); continue; }
    const missing = staleness(s, f.expected, f.plugin?.protocol ?? null);
    add("services", label, missing.length ? "behind" : "ok",
      `${s.root ?? s.stateDir}, protocol ${s.protocol ?? "?"}${missing.length ? `; runs old code, missing ${missing.join(", ")}: restart to pick up new features` : ""}${s.paneId ? `; Herdr pane ${s.paneId}` : ""}`,
      missing.length ? (s.paneId ? "ep0ch install --apply --restart-services" : "stop it and reopen the Outliner in that folder") : undefined);
  }
  if (f.databases.length) add("services", "databases", "info", f.databases.map(d => `${d.name} ${d.path}`).join("; "));

  // Herdr
  if (!f.herdr.path) add("herdr", "herdr", "missing", "not on PATH", "see https://herdr.dev");
  else {
    add("herdr", "server", f.herdr.server ? "ok" : "missing", f.herdr.server ? `running (${f.herdr.path} ${f.herdr.version ?? ""})`.replace(" )", ")") : "not running", f.herdr.server ? undefined : "herdr");
    const missing = KEYED_ACTIONS.filter(a => !f.herdr.keys[a]);
    const bound = KEYED_ACTIONS.filter(a => f.herdr.keys[a]).map(a => `${a} ${f.herdr.keys[a]}`).join(", ");
    add("herdr", "keys", missing.length ? "missing" : "ok", missing.length ? `no key for ${missing.join(", ")} in ${f.herdr.configPath}${bound ? ` (bound: ${bound})` : ""}` : bound,
      missing.length ? `add [[keys.command]] entries (type = "plugin_action", command = "${PLUGIN_ID}.<action>"), or run the Outliner's install.sh` : undefined);
    const unregistered = p ? KEYED_ACTIONS.filter(a => !p.actions.includes(a)) : [];
    if (unregistered.length) add("herdr", "actions", "behind", `the plugin doesn't register ${unregistered.join(", ")}`, "update the plugin (ep0ch install --apply)");
  }

  // Claude
  const mod = claudeModState(f);
  add("claude", "claude-mod", mod.status, mod.detail, mod.fix);
  if (f.claude.forceHyperlink !== undefined) add("claude", "FORCE_HYPERLINK", "info", `set to ${f.claude.forceHyperlink}: a known issue (PIE-486)`);
  for (const c of doorAgentChecks(f)) out.push(c);
  return out;
}

/** The fix for a door agent that doesn't know what it should: a restart, which keeps the conversation. */
export const AGENT_RESTART_FIX = {
  dock: "restart it: the ⟳ on its door's ▲ claude chip, alt+R, or `ep0ch act agent.restart` (it keeps the conversation)",
  tile: "restart it: /exit in its tile, then claude --continue",
};
/** The door's own agent (the ▲ claude chip, D's daily tile, its Herdr pane): `agent.restart` restarts it. */
const isDockAgent = (env: Record<string, string> | null) => env?.EP0CH_TILE_ID === DOCK_TILE_ID || /(^| › )herdr:[^›]*$/.test(env?.EP0CH_NEST ?? "") && !!env?.EP0CH_NEST?.includes("door:");

/** Door agents (Claude in a door tile or the door's Herdr pane) running on an older mod, or without door tools. */
export function doorAgentChecks(f: Facts): Check[] {
  const agents = f.claude.agents;
  if (!agents) return [];
  if (!agents.length) return [{ group: "claude", name: "door agents", status: "info", detail: "no Claude running in a door tile or the door's Herdr pane" }];
  return agents.map(a => {
    const where = a.env?.EP0CH_NEST?.split(" › ").at(-1) ?? a.env?.EP0CH_TILE ?? "a door";
    const name = `agent ${a.pid}`;
    const detail = `${where}: ${a.knows.why}`;
    if (a.knows.state === "current") return { group: "claude", name, status: "ok" as const, detail };
    if (a.knows.state === "unknown") return { group: "claude", name, status: "info" as const, detail };
    return { group: "claude", name, status: "behind" as const, detail, fix: isDockAgent(a.env) ? AGENT_RESTART_FIX.dock : AGENT_RESTART_FIX.tile };
  });
}

export function doctorReport(f: Facts) {
  const checks = doctorChecks(f);
  return { platform: f.platform, ok: checks.every(c => c.status === "ok" || c.status === "info"), checks };
}

export function formatDoctor(f: Facts, checks = doctorChecks(f)): string {
  const lines = [`ep0ch doctor · ${f.platform} · ${f.home}`];
  let group = "";
  const width = Math.max(...checks.map(c => c.name.length));
  for (const c of checks) {
    if (c.group !== group) { group = c.group; lines.push("", group); }
    lines.push(`  ${MARK[c.status]} ${c.name.padEnd(width)}  ${c.detail}`);
    if (c.fix) lines.push(`    ${" ".repeat(width)}  fix: ${c.fix}`);
  }
  const bad = checks.filter(c => c.status === "behind" || c.status === "missing").length;
  const unknown = checks.filter(c => c.status === "unknown").length;
  const unchecked = unknown ? `${unknown} couldn't be checked (? above)` : "";
  lines.push("", bad ? `${bad} to fix${unchecked ? `, ${unchecked}` : ""}; \`ep0ch install\` shows the plan, \`ep0ch install --apply\` runs it` : unchecked ? `${unchecked}; the rest is current` : "all current");
  return lines.join("\n");
}
