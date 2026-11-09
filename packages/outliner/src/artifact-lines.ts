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
import { artifactMachine, askMachine, MachineUnreachable, readElsewhere } from "./artifact-machine";
import type { ArtifactStore } from "./artifact-store";
import { localMachineName } from "./machine-name";
import { MediaCopier, readMachineFile } from "./media-copies";
import { COPY_NEEDS_BYTES } from "./artifact-store";
import type { MediaRead } from "@ep0ch/outline-core/media-copy";
import { createHash } from "node:crypto";
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
  /**
   * A read-only copy of another machine's outline (a laptop's, while it sleeps): that machine's name. Its lines are
   * answered from this machine's own store and the copies its records name, never from this disk.
   */
  copyOf?: string;
}

/** The outline's media copier: pictures and artifact files, and the machines it asks for a file that isn't here. */
export function lineCopier(store: OutlinerStore, options: { readOnly: boolean; outlinesFolder?: string; filesHere?: (path: string) => boolean }): MediaCopier {
  const outlines = options.outlinesFolder;
  return new MediaCopier(store, {
    readOnly: options.readOnly, log: (line) => console.error(line), ...(options.filesHere ? { filesHere: options.filesHere } : {}),
    ...(outlines ? { elsewhere: (path: string, artifact: boolean) => readElsewhere(outlines, path, artifactMachine(outlines), artifact) } : {}),
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
  const here = host.copyOf ?? localMachineName(host.outlinesFolder), workspace = host.store.workspaceRoot, asked = request.name.trim();
  const local = (input: Show) => host.artifacts().request(input, workspace, host.outline) as Promise<ArtifactInfo>;
  // The store's machine not answering is said as what it means for this line, never as the link's own repair steps.
  const ask = (input: Show) => !store ? local(input) : askMachine<ArtifactInfo>(host.outlinesFolder!, store, input as never).catch((error: unknown) => {
    if (error instanceof MachineUnreachable) throw new Error(`${asked} runs from ${store}, where ${here}'s artifacts are kept, and ${store} isn't answering now: it shows once ${store} is back`);
    throw error;
  });
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
  if (!store && !host.copyOf && path && (host.filesHere?.(path) ?? true) && existsSync(path)) return local({ ...request, ...framed });
  const copy = await host.media.ensure(asked);
  const from = (mtime: string) => mtime.startsWith("@") ? mtime.slice(1) : here;
  if (copy.row && copy.path) {
    const machine = from(copy.row.mtime_ns), named = { machine, path: copy.path, sha256: copy.row.sha256 };
    // Not in the bucket (this machine has no bucket keys, or its upload failed): the store's own machine runs a file it
    // read as it always has. Any store is asked by the hash first, and handed the bytes when it can't find them.
    if (!copy.row.copied_at && !store && !host.copyOf && machine === here) return local({ ...request, ...framed });
    try { return await ask({ action: "artifacts.show", name: asked, ...framed, copy: named }); }
    catch (error) { if (!(error instanceof Error && error.message.includes(COPY_NEEDS_BYTES))) throw error; }
    let bytes = copy.bytes;
    if (!bytes) {
      const read = machine === here ? readMachineFile(copy.path, undefined, true) : await askMachine<MediaRead>(host.outlinesFolder!, machine, { action: "media.read", path: copy.path, artifact: true }, 60_000);
      bytes = Buffer.from(read.base64, "base64");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return ask({ action: "artifacts.show", name: asked, ...framed, copy: { ...named, sha256, base64: bytes.toString("base64") } });
  }
  if (copy.problem) throw new Error(copy.problem);
  // The store's record of a path that has gone (its last snapshot, with a warning) still answers.
  if (!store && !host.copyOf) { try { return await local({ ...request, ...framed }); } catch { /* said below */ } }
  const asleep = (copy.tried ?? []).filter(row => row.said === "not answering").map(row => row.machine);
  const tried = [...(host.copyOf ? [] : [here]), ...(copy.tried ?? []).map(row => row.machine).filter(machine => !asleep.includes(machine))];
  const where = tried.length ? `${asked} isn't on ${either(tried)}` : `${asked} can't be found`;
  if (asleep.length) throw new Error(`${where}, and ${either(asleep)} ${asleep.length > 1 ? "aren't" : "isn't"} answering to ask: it shows once ${asleep.length > 1 ? "they're" : `${asleep[0]} is`} back.`);
  throw new Error(`${where}${isAbsolute(asked) ? "" : ` (a path that doesn't start with / is looked for on ${here} only)`}: ${tried.length > 1 ? "put the file on one of them" : "put the file there"}, or write its path on the machine that has it.`);
}
