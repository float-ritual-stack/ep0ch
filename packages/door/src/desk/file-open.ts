// `open file=<path>` (PIE-602): a file on this machine as a note where opens land, the way a Claude's Edit or Write row
// asks for it. No reader of its own: Markdown is drawn as the preview tile draws a file (`fileNote`), any other file
// through the file Resource reader (`openResource`, the same one a `[file::]` link opens), and `diff=true` is the
// file's changes as a ```diff note, which the note surface colours by line.
//
// The diff is git's: the file against its last commit when it is in a repository, else against `against=` (a copy of
// the file taken before it was changed, which the Claude mod's touch block names), with `git diff --no-index`.
import { existsSync } from "node:fs";
import { basename, dirname, extname, isAbsolute } from "node:path";
import type { Msg } from "../board";
import { openResource } from "../authored";
import { ActionRefused } from "../surface/actions";
import { fileNote } from "./preview";

const MARKDOWN = new Set([".md", ".markdown", ".mdx"]);
/** The most of a diff a note holds; the rest is said, never silently dropped. */
const DIFF_MAX = 200_000;

type Board = Parameters<typeof openResource>[0];
type Run = (argv: string[], cwd: string) => Promise<{ code: number; out: string }>;

const run: Run = async (argv, cwd) => {
  const p = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { ...process.env, GIT_PAGER: "cat", LC_ALL: "C" } });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return { code, out };
};

/** The note `open file=` shows: the file, or its diff. */
export async function fileOpenNote(board: Board, path: string, o: { diff?: boolean; against?: string } = {}, actor?: unknown, exec: Run = run): Promise<Msg> {
  if (!isAbsolute(path)) throw new ActionRefused(`file= takes an absolute path, not ${path}`);
  if (o.diff) return diffNote(path, o.against, exec);
  if (!existsSync(path)) throw new ActionRefused(`no file ${path} on this machine`);
  if (MARKDOWN.has(extname(path).toLowerCase())) return fileNote(path);
  return (await openResource(board, { reference: { kind: "filesystem", path } }, actor)).note;
}

/** The file's changes: git's diff against its last commit, else against `against`. */
export async function diffNote(path: string, against: string | undefined, exec: Run = run): Promise<Msg> {
  const dir = dirname(path);
  let diff = "", from = "";
  // --literal-pathspecs: a file named `*.txt` is that file, never a pattern over others.
  const git = (...args: string[]) => exec(["git", "--literal-pathspecs", ...args], dir);
  const top = existsSync(dir) ? await git("rev-parse", "--show-toplevel") : { code: 1, out: "" };
  const tracked = top.code === 0 && (await git("ls-files", "--error-unmatch", "--", path)).code === 0;
  if (tracked) {
    // Tracked: against HEAD (what is staged and not).
    diff = (await git("diff", "--no-color", "HEAD", "--", path)).out;
    from = "against its last commit";
  } else if (top.code === 0 && !(against && existsSync(against))) {
    // New to git, with no copy from before: the whole file as added.
    diff = (await git("diff", "--no-color", "--no-index", "--", "/dev/null", path)).out;
    from = "a new file, not in git yet";
  }
  if (!diff && against && existsSync(against)) {
    diff = (await exec(["git", "diff", "--no-color", "--no-index", "--", against, path], existsSync(dir) ? dir : "/")).out;
    from = "against the copy taken when the session first touched it";
  }
  const name = basename(path);
  // git's header names the paths compared (a temp copy's, long): the note's own line says what was compared with.
  diff = diff.replace(/^[\s\S]*?(?=^@@)/m, "");
  const cut = diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n… ${diff.length - DIFF_MAX} more characters (git diff shows the rest)` : diff;
  const body = cut.trim() ? `\`\`\`diff\n${cut.replace(/\n$/, "")}\n\`\`\`` : top.code === 0 || against ? "No changes." : "Not in a git repository, and no copy from before the change to compare with.";
  const at = Date.now();
  return { id: `file-diff:${path}`, text: `${name} · diff\n*${path}${from ? ` · ${from}` : ""}*\n\n${body}`, parentId: null, childIds: [], createdAt: at, updatedAt: at, author: "file", props: {} };
}
