// What an outline answers for its artifact lines (PIE-1644): `[artifact::<name>]` from the artifact machine's one store,
// `[artifact::<path>]` from this machine's disk, else from its copy in the media bucket (media-copies.ts), made on save
// or when first asked, from whichever machine had the file. The outline's card, the door's open and every page ask
// `artifacts.show`; on a machine whose artifacts are kept on another (artifact-machine.ts), every store action goes
// there, so a name, its page and its frame are that store's. What can't be found says what was tried, on which
// machines, and the one thing to do; never a socket, a store or a command to move files.
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { artifactReference, type ArtifactInfo, type ArtifactRequest } from "@ep0ch/outline-core/artifacts";
import { artifactKind } from "@ep0ch/outline-core/media-line";
import { artifactMachine, askMachine, readElsewhere } from "./artifact-machine";
import type { ArtifactStore } from "./artifact-store";
import { localMachineName } from "./machine-name";
import { MediaCopier } from "./media-copies";
import type { OutlinerStore } from "./store";

/** What an outline's artifact lines need of the outline that holds them. */
export interface ArtifactLineHost {
  store: OutlinerStore;
  /** The host's outlines folder; none for a lone service, whose artifacts are its own machine's. */
  outlinesFolder?: string;
  outline?: string;
  media: MediaCopier;
  artifacts(): ArtifactStore;
  /** Which absolute paths are on this machine's disk (a test's two machines share one). */
  filesHere?: (path: string) => boolean;
}

/** The outline's media copier: pictures and artifact files, and the machines it asks for a file that isn't here. */
export function lineCopier(store: OutlinerStore, options: { readOnly: boolean; outlinesFolder?: string; filesHere?: (path: string) => boolean }): MediaCopier {
  const outlines = options.outlinesFolder;
  return new MediaCopier(store, {
    readOnly: options.readOnly, log: (line) => console.error(line), ...(options.filesHere ? { filesHere: options.filesHere } : {}),
    ...(outlines ? { elsewhere: (path: string) => readElsewhere(outlines, path, artifactMachine(outlines)) } : {}),
  });
}

/** What an outline on a machine whose artifacts are kept on another asks that machine's store for, as it is. */
const DELEGATED: ReadonlySet<string> = new Set(["artifacts.put", "artifacts.list", "artifacts.versions", "artifacts.snapshot", "artifacts.rm", "artifacts.upload.begin", "artifacts.upload.chunk", "artifacts.upload.finish", "artifacts.upload.abort"]);

/** An `artifacts.*` request that isn't the outline's own (lease, deploy, dns, backfill, a repo's line), answered. */
export function answerArtifact(host: ArtifactLineHost, request: ArtifactRequest): ReturnType<ArtifactStore["request"]> {
  const machine = host.outlinesFolder ? artifactMachine(host.outlinesFolder) : null;
  if (request.action === "artifacts.show") return showArtifact(host, machine, request);
  if (machine && DELEGATED.has(request.action)) return askMachine<Awaited<ReturnType<ArtifactStore["request"]>>>(host.outlinesFolder!, machine, request as never);
  return host.artifacts().request(request, host.store.workspaceRoot, host.outline);
}

type Show = Extract<ArtifactRequest, { action: "artifacts.show" }>;

/** `a, b or c`. */
const either = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0]!;

async function showArtifact(host: ArtifactLineHost, store: string | null, request: Show): Promise<ArtifactInfo> {
  const here = localMachineName(host.outlinesFolder), workspace = host.store.workspaceRoot, asked = request.name.trim();
  const local = (input: Show) => host.artifacts().request(input, workspace, host.outline) as Promise<ArtifactInfo>;
  const ask = (input: Show) => store ? askMachine<ArtifactInfo>(host.outlinesFolder!, store, input as never) : local(input);
  // A share's frame from another machine's store names this outline there, so that store's host asks here whether it's open.
  const frame = request.frame && store && "share" in request.frame && host.outline ? { share: { ...request.frame.share, outline: `${host.outline}@${here}` } } : request.frame;
  const framed = frame ? { frame } : {};
  if (request.copy) return ask({ ...request, ...framed });
  const reference = artifactReference(asked);
  const isPath = !reference || !!artifactKind(asked) || asked.startsWith("~")
    || (!!workspace && existsSync(resolve(workspace, asked)) && !existsSync(join(host.outlinesFolder ?? "", ".artifacts", "live", asked)));
  if (!isPath) {
    try { return await ask({ action: "artifacts.show", name: asked, ...framed }); }
    catch (error) {
      if (!/No artifact is called|has no version/.test(error instanceof Error ? error.message : String(error))) throw error;
      throw new Error(`No artifact is called “${asked}” on ${store ?? here}${store ? `, where ${here}'s artifacts are kept` : ""}: write the file's path instead, [artifact::/path/to/${reference!.name}.html]`);
    }
  }
  // A file on the store's own machine runs from there as it always has, bucket or none.
  const path = host.media.resolve(asked);
  if (!store && path && (host.filesHere?.(path) ?? true) && existsSync(path)) return local({ ...request, ...framed });
  const copy = await host.media.ensure(asked);
  const from = (mtime: string) => mtime.startsWith("@") ? mtime.slice(1) : here;
  if (copy.row?.copied_at && copy.path) return ask({ action: "artifacts.show", name: asked, ...framed, copy: { machine: from(copy.row.mtime_ns), path: copy.path, sha256: copy.row.sha256 } });
  // Found but not copied: no bucket, or an upload that failed. The store's own machine still runs a file it read.
  if (copy.row) {
    if (!store) return local({ ...request, ...framed });
    throw new Error(`${asked} is on ${from(copy.row.mtime_ns)}, but it can't reach ${store}, where artifacts run: ${copy.row.error ?? host.media.bucketProblem() ?? "its copy hasn't landed yet; try again in a moment"}`);
  }
  if (copy.problem) throw new Error(copy.problem);
  // The store's record of a path that has gone (its last snapshot, with a warning) still answers.
  if (!store) { try { return await local({ ...request, ...framed }); } catch { /* said below */ } }
  const tried = [here, ...(copy.tried ?? []).map(row => row.machine)];
  throw new Error(`${asked} isn't on ${either(tried)}${isAbsolute(asked) ? "" : ` (a path that doesn't start with / is looked for on ${here} only)`}: ${tried.length > 1 ? "put the file on one of them" : `put the file there`}, or write its path on the machine that has it.`);
}
