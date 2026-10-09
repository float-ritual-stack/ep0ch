// Raw reasons (a fetch error, restic's complaint, ssh's silence) in plain words (PIE-702). No imports: alert.ts, verdict.ts
// and the run's progress lines all use it. The raw text stays in `--verbose` and `--json`.

/** What a person reads as the repository's name: its host, as Hetzner when it is one. */
export function repoHost(repo: string): string {
  const host = /^s3:(?:https?:\/\/)?([^/]+)/.exec(repo)?.[1];
  if (!host) return "the backup repository";
  return /hetzner|your-objectstorage|(?:^|\.)(?:hel1|fsn1|nbg1)\b/i.test(host) ? "Hetzner" : host;
}

export const SILENT = /connection reset|doesn'?t answer|didn'?t answer|socket connection was closed|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out|unable to open|network is unreachable|no reply/i;

/** One raw reason (a fetch error, restic's complaint, ssh's silence) in plain words; the raw text stays in --verbose and --json. */
export function plainReason(raw: string, o: { repo?: string; hub?: string | null } = {}): string {
  const text = raw.trim();
  const repo = repoHost(o.repo ?? text);
  if (/\bdoesn'?t answer over ssh\b/.test(text)) return `${o.hub ?? "the other machine"} didn't answer over ssh`;
  if (/no ep0ch on a login shell/.test(text)) return `${o.hub ?? "the other machine"} has no ep0ch on its login shell's PATH`;
  if (/wrong password|Fatal: .*(decrypt|key)|unable to open config file.*(denied|forbidden)|AccessDenied|InvalidAccessKey|SignatureDoesNotMatch|\b40[13]\b/i.test(text)) return `${repo} refused the keys`;
  if (SILENT.test(text)) return `${repo} didn't answer (probably the VPN, or no network)`;
  if (/no space left|ENOSPC/i.test(text)) return "the disk is full";
  if (/integrity|malformed|corrupt/i.test(text)) return "the copy failed its integrity check";
  if (/\bdamaged\b/.test(text)) return "the copy arrived damaged";
  // Never pass a fetch hint through; one short first line at most.
  const line = (text.split("\n")[0] ?? "").replace(/\s*\(?For more information, pass `verbose: true`[^)]*\)?/i, "").replace(/\s+/g, " ").trim();
  return line && line.length <= 90 ? line : "it failed for a reason --verbose shows";
}

/** An outline's stored failure (`<why>; relaying through <hub> failed: <why>`, or just a reason) in plain words. */
export function plainFailure(error: string, o: { repo?: string; hub?: string | null } = {}): string {
  const m = /^(.*?);? relaying through (\S+) failed: (.*)$/s.exec(error);
  if (!m) return plainReason(error, o);
  const direct = plainReason(m[1]!, o), relay = plainReason(m[3]!, { ...o, hub: m[2]! });
  return direct === relay ? direct : `${direct}, and ${relay}`;
}

