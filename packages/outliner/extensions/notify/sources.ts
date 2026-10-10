// The sources. Each is a `Source` (notification.ts): the notifications changed since a time, in one shape.
// GitHub is real (the `gh` CLI, read-only). Gmail, Jira and Slack read a made-up JSON file named in config `fixtures`
// until a real one is plugged in (README: "Plugging in a real source").
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Notification, Source } from "./notification";

interface GithubThread {
  id: string; unread: boolean; reason: string; updated_at: string;
  subject: { title: string; type: string; url: string | null };
  repository: { full_name: string; html_url: string };
}

/** The web page of a subject whose API URL is `https://api.github.com/repos/o/r/pulls/12`. */
export function githubWebUrl(thread: Pick<GithubThread, "subject" | "repository">): string {
  const api = thread.subject.url ?? "";
  const m = api.match(/\/repos\/([^/]+\/[^/]+)\/(pulls|issues|commits|releases)\/([^/?#]+)/);
  if (!m) return thread.repository.html_url;
  const [, repo, kind, id] = m;
  return `https://github.com/${repo}/${kind === "pulls" ? "pull" : kind === "commits" ? "commit" : kind}/${id}`;
}

export function fromGithub(thread: GithubThread): Notification {
  return {
    id: thread.id, source: "github", kind: thread.subject.type, from: thread.repository.full_name,
    title: thread.subject.title, url: githubWebUrl(thread), unread: thread.unread, received: thread.updated_at,
    snippet: `Reason: ${thread.reason}`,
  };
}

async function gh(args: string[], home?: string): Promise<string> {
  // A call's environment is PATH and LANG: gh finds its login under HOME, so give it the service user's (or config `home`).
  const env = { ...(process.env as Record<string, string>), HOME: home ?? process.env.HOME ?? homedir() };
  const run = Bun.spawn(["gh", ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  if (code !== 0) throw new Error(`gh ${args[0]} failed (${code}): ${err.trim().split("\n")[0] ?? ""}`.replace(/(gh[pousr]_|github_pat_)\w+/g, "[token]"));
  return out;
}

export const github: Source = {
  async fetch({ since, home }) {
    // all=true so a thread read on github.com is seen as read; since keeps it to what changed.
    const out = await gh(["api", "--paginate", "--slurp", `notifications?all=true&per_page=100&since=${encodeURIComponent(since)}`], home);
    return (JSON.parse(out) as GithubThread[][]).flat().map(fromGithub);
  },
};

/** A source that reads made-up notifications from a JSON file: the shape a real source returns. */
export const fixture = (name: string, path: string): Source => ({
  async fetch({ since }) {
    const all = JSON.parse(readFileSync(join(import.meta.dir, path), "utf8")) as Array<Omit<Notification, "source">>;
    return all.map((n) => ({ ...n, source: name })).filter((n) => n.received > since);
  },
});

export const REAL: Record<string, Source | undefined> = { github };
