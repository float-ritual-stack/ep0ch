// The backup's verdict for a person (PIE-702): one line first, what is wrong NOW apart from what happened THEN, raw
// errors turned into plain words, and one command when something needs doing. Pure over the job's state and alert
// (`incidents` in alert.ts decides what is stale; this decides how it reads), so `ep0ch backup status`, the run's own
// progress lines and the doctor's backup line say the same thing, and tests describe a history instead of living it.
// `--json` keeps everything and `--verbose` keeps the raw reasons: nothing here deletes them, it only stops leading with them.
import { plainFailure, plainReason, repoHost, SILENT } from "./plain";
import { type Alert, alertMark, type BackupState, hhmm, type OutlineState } from "./alert";

export type Level = "ok" | "warn" | "bad";
export interface Problem { level: Level; text: string; fix: string }
export interface Verdict {
  level: Level;
  /** `✓ all backed up`, `! 1 problem`, `✗ failing`, or `? not run here yet`. */
  headline: string;
  /** True now, worst first. */
  problems: Problem[];
  /** The one command to run next (the first problem's), or null. */
  fix: string | null;
}

/** `Oct 9 08:12Z` */
export const moment = (t: string | number) => {
  const d = new Date(t);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCDate()} ${hhmm(t).slice(11)}`;
};

/** The command to give for a failure: the VPN is a person's to turn off, the run is the job's. */
export const RUN = "ep0ch backup run";

/** The plain progress line for an outline the run could not back up (what the run says, not what status shows). */
export function failedLine(name: string, error: string, o: { repo?: string; hub?: string | null } = {}): string {
  return `✗ ${name}: not backed up: ${plainFailure(error, o)}. Next: ${hintFor(error)}`;
}
function hintFor(error: string): string {
  if (/relaying through \S+ failed/.test(error)) return `turn the VPN off, or check the other machine (ssh <it> true), then ${RUN}`;
  if (/refused the keys|wrong password|AccessDenied|InvalidAccessKey|SignatureDoesNotMatch/i.test(error)) return "with-secrets --list (the repository keys), then " + RUN;
  if (SILENT.test(error)) return `turn the VPN off or check the network, then ${RUN}`;
  return `${RUN} (ep0ch backup status --verbose has the raw reason)`;
}

/** The plain progress line for an outline that went through the hub instead of straight to the repository. */
export function relayedLine(name: string, seq: number | null | undefined, hub: string, why: string, uploaded: boolean, o: { repo?: string } = {}): string {
  return `✓ ${name} (change ${seq ?? "?"}) backed up via ${hub}: ${plainReason(why, { ...o, hub })}, so it went through ${hub}${uploaded ? " and is in the repository" : `, which couldn't upload it yet. Next: ${RUN} when ${repoHost(o.repo ?? why)} answers`}`;
}

export interface VerdictContext { machine: string; repo: string; hub?: string | null }

const firstCommand = (fix: string) => fix.split(/ {3,}\(/)[0]!.trim();

/** What is true now (problems), and how that reads in one line. */
export function verdict(s: BackupState, a: Alert | null, now: number, c: VerdictContext): Verdict {
  const problems: Problem[] = [];
  const covered = new Set<string>();
  const opts = { repo: c.repo, hub: c.hub };
  for (const [name, o] of Object.entries(s.outlines).sort()) {
    if (o.error) {
      covered.add(`outline:${c.machine}/${name}`);
      problems.push({ level: "bad", text: `${name}: not backed up: ${plainFailure(o.error, opts)}`, fix: RUN });
    } else if (o.relayed && !o.relayed.uploaded) {
      problems.push({ level: "warn", text: `${name}: held on ${o.relayed.via} but not in the repository yet: ${o.relayed.via} couldn't upload it`, fix: RUN });
    }
  }
  for (const i of a?.incidents ?? []) {
    if (covered.has(i.key)) continue;
    problems.push({ level: "bad", text: `${i.title}: ${i.detail}`, fix: firstCommand(i.fix) });
  }
  for (const [key, m] of Object.entries(s.mirrors).sort()) {
    if (m.error && !(a?.incidents ?? []).some(i => i.key === `mirror:${key}` || i.key === `pending:${key}`)) {
      problems.push({ level: "warn", text: `mirror ${key}: ${plainReason(m.error, opts)}`, fix: "ep0ch backup mirror" });
    }
  }
  for (const [from, x] of Object.entries(s.sources ?? {}).sort()) {
    if (x.error && !x.missing && !(a?.incidents ?? []).some(i => i.key === `source:${from}`)) {
      problems.push({ level: "warn", text: `can't read ${from}'s backups: ${plainReason(x.error, opts)}`, fix: "ep0ch backup mirror" });
    }
  }
  const mark = alertMark(a, now);
  if (mark && mark.text === "? backup") problems.push({ level: "warn", text: mark.say.replace(/ · .*$/, ""), fix: "ep0ch doctor" });
  if (!problems.length && s.lastRun && !s.lastRun.ok && !s.lastRun.detail.includes("unreadable")) {
    problems.push({ level: "bad", text: `the last run failed (${moment(s.lastRun.at)}): ${s.lastRun.detail}`, fix: RUN });
  }
  problems.sort((x, y) => (x.level === y.level ? 0 : x.level === "bad" ? -1 : 1));
  if (!s.lastRun && !problems.length) return { level: "warn", headline: "? not run here yet", problems: [{ level: "warn", text: "the backup job hasn't run on this machine", fix: RUN }], fix: RUN };
  const level: Level = problems.some(p => p.level === "bad") ? "bad" : problems.length ? "warn" : "ok";
  const headline = level === "ok" ? "✓ all backed up" : level === "bad" ? "✗ failing" : `! ${problems.length} problem${problems.length === 1 ? "" : "s"}`;
  return { level, headline, problems, fix: problems[0]?.fix ?? null };
}

export interface StatusOptions { verbose?: boolean; colour?: boolean }

/** Palette slots (style.ts C): lgreen, yellow, lred, dark; the theme maps them, so dark themes stay dark. */
export const PALETTE = { ok: 10, warn: 14, bad: 12, dim: 8 } as const;
export type Tint = (kind: keyof typeof PALETTE, s: string) => string;
export const noTint: Tint = (_k, s) => s;

const routeOf = (o: OutlineState) => !o.at ? "–" : o.relayed ? `via ${o.relayed.via}` : "direct";

/** Aligned columns, two spaces between, the last unpadded; `width` measures what a person sees (colour included). */
function columns(rows: string[][], visible: (s: string) => number): string[] {
  const w: number[] = [];
  for (const r of rows) r.forEach((c, i) => { w[i] = Math.max(w[i] ?? 0, visible(c)); });
  return rows.map(r => r.map((c, i) => (i < r.length - 1 ? c + " ".repeat(w[i]! - visible(c)) : c)).join("  ").trimEnd());
}

/** The status page: verdict, the command, this machine's outlines, then history. `age` is alert.ts's. */
export function renderStatus(o: {
  s: BackupState; a: Alert | null; now: number; machine: string; repo: string; hub?: string | null; machineNote: string;
  age: (ms: number) => string; tint: Tint; visible: (s: string) => number; verbose?: boolean; netmail: string[];
}): string[] {
  const { s, now, tint } = o;
  const v = verdict(s, o.a, now, { machine: o.machine, repo: o.repo, hub: o.hub });
  const out: string[] = [tint(v.level, v.headline)];
  for (const p of v.problems) out.push(`  ${tint(p.level, p.level === "bad" ? "✗" : "!")} ${p.text}`);
  if (v.fix) out.push(`  ${tint("dim", "run:")} ${v.fix}`);
  out.push("", `${o.machine} (${o.machineNote}) · ${o.repo}`);
  const names = Object.keys(s.outlines).sort();
  if (names.length) {
    const rows = [["outline", "newest", "age", "route", "state"].map(h => tint("dim", h))];
    for (const name of names) {
      const x = s.outlines[name]!;
      const state = x.error ? tint("bad", "failing") : x.relayed && !x.relayed.uploaded ? tint("warn", "held, not uploaded")
        : x.pendingSince ? tint("warn", `changes waiting ${o.age(now - Date.parse(x.pendingSince))}`) : tint("ok", "ok");
      rows.push([name, x.at ? moment(x.at) : "never", x.at ? o.age(now - Date.parse(x.at)) : "–", routeOf(x), state]);
    }
    out.push(...columns(rows, o.visible).map(l => `  ${l}`));
  } else out.push(s.lastRun ? "  no outlines here" : "  the job hasn't run here yet (ep0ch backup run)");
  const mirrors = Object.entries(s.mirrors).sort();
  if (mirrors.length) {
    out.push("", "mirrors");
    const rows = mirrors.map(([key, m]) => [key, m.at ? moment(m.at) : "none yet", m.at ? o.age(now - Date.parse(m.at)) : "–", m.source ?? "–",
      m.error ? tint("warn", plainReason(m.error, { repo: o.repo, hub: o.hub })) : m.pendingSince ? tint("warn", `its machine changed ${moment(m.pendingSince)}`) : tint("ok", "ok")]);
    out.push(...columns(rows, o.visible).map(l => `  ${l}`));
  }
  // History: what happened, not what is wrong.
  const hist: string[] = [];
  if (s.lastRun) hist.push(`last run ${moment(s.lastRun.at)} (${o.age(now - Date.parse(s.lastRun.at))} ago): ${s.lastRun.ok ? "ok" : "failed"}, ${s.lastRun.detail}`);
  for (const name of names) {
    const r = s.outlines[name]!.relayed;
    if (r?.uploaded) hist.push(`${name}'s last upload went through ${r.via} at ${moment(r.at)} because ${plainReason(r.why, { repo: o.repo, hub: r.via }).replace(/ \(probably.*\)$/, "")} then`);
  }
  if (s.drill) {
    const n = (s.drill.detail.match(/ ok \(/g) ?? []).length, total = n + (s.drill.detail.match(/ FAILED:/g) ?? []).length;
    hist.push(total ? `restore drill ${moment(s.drill.at)}: ${n} of ${total} restored ok${n === total ? "" : " (ep0ch backup drill)"}` : `restore drill ${moment(s.drill.at)}: ${s.drill.ok ? "ok" : "failed"}`);
  }
  hist.push(...o.netmail);
  if (hist.length) { out.push("", tint("dim", "history")); out.push(...hist.map(h => `  ${h}`)); }
  if (o.verbose) {
    out.push("", tint("dim", "raw"));
    for (const name of names) {
      const x = s.outlines[name]!;
      if (x.error) out.push(`  ${name} error: ${x.error}`);
      if (x.relayed) out.push(`  ${name} relayed via ${x.relayed.via} at ${hhmm(x.relayed.at)}; the repository said: ${x.relayed.why}${x.relayed.uploadError ? `; ${x.relayed.via} said: ${x.relayed.uploadError}` : ""}`);
      if (x.seq !== undefined) out.push(`  ${name} change ${x.seq ?? "?"}${x.pendingSince ? `, changes waiting since ${hhmm(x.pendingSince)}` : ""}`);
    }
    for (const [key, m] of mirrors) out.push(`  mirror ${key}: ${m.folder ?? "?"}${m.error ? `; ${m.error}` : ""}`);
    if (s.drill) for (const d of s.drill.detail.split("; ")) out.push(`  drill: ${d}`);
    if (!names.length && !mirrors.length && !s.drill) out.push("  (nothing recorded)");
  }
  const mark = o.a ? alertMark(o.a, now) : null;
  if (!o.a) out.push("", tint("dim", "the job hasn't checked yet"));
  else if (mark && !v.problems.length) out.push("", `alert: ${mark.say}`);
  return out;
}
