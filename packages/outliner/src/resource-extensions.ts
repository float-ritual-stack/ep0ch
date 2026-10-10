import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { Type, IsSchema } from "typebox";
import { Parse } from "typebox/value";
import { Compile } from "typebox/compile";
import { ResourceCatalogError } from "./resources";
import { issueGrant, revokeGrant } from "./extension-grants";
import { readGroupSecret } from "./extension-secrets";
import type { MutationProvenance } from "./types";
import {
  CredentialSchema,
  ExtensionLoadError,
  MAX_DEADLINE_MS,
  RESERVED_EXTENSION_ENV,
  folderStamp,
  readExtensionFolder,
  type ExtensionHandler,
  type ExtensionOrigin,
  type LoadedExtension,
} from "./extension-manifest";

const Credential = CredentialSchema;
const Installation = Type.Object(
  {
    manifest: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    config: Type.Record(Type.String(), Type.Unknown()),
    credentials: Type.Record(Type.String(), Credential, { maxProperties: 16 }),
  },
  { additionalProperties: false },
);
const Registry = Type.Object(
  {
    version: Type.Literal(1),
    providers: Type.Record(Type.String(), Installation),
  },
  { additionalProperties: false },
);
export type { ExtensionHandler };
export interface ExtensionSourceConfig { readonly origin: string; readonly project: string }
/** What the service knows of an installed extension without running it. */
export interface ExtensionDescription {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly contract: 1 | 2;
  readonly directory: string;
  readonly handlers: readonly ExtensionHandler[];
  readonly sources: readonly ExtensionSourceConfig[];
  /** Which folder it came from (contract 2). */
  readonly origin?: ExtensionOrigin;
}
const Manifest = Type.Object(
  {
    contract: Type.Literal(1),
    id: Type.String({ pattern: "^[a-z0-9][a-z0-9.-]{0,99}$" }),
    version: Type.Integer({ minimum: 1 }),
    command: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 20,
    }),
    configSchema: Type.Unknown(),
  },
  { additionalProperties: false },
);
const MAX_CONFIG_BYTES = 64 * 1024,
  MAX_REQUEST_BYTES = 256 * 1024,
  MAX_RESULT_BYTES = 1024 * 1024;
const ERROR_MESSAGES: Record<string, string> = {
  "credentials-missing": "credentials are unavailable",
  unauthorized: "authentication failed (401)",
  forbidden:
    "access denied (403); check authentication mode and project access",
  "not-found": "item was not found",
  "outside-source": "item is outside the configured Source",
  "invalid-config": "configuration is invalid",
  "invalid-response": "provider returned an invalid response",
  network: "provider request failed",
  timeout: "provider request timed out",
  "invalid-query": "the provider refused the search (400)",
  "rate-limited": "the provider is limiting requests (429); fetching again later",
};
/** The user extensions folder on the service host (wave B also watches the outline's own). */
export function userExtensionsDirectory(): string {
  return process.env.OUTLINER_EXTENSIONS_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pi-herdr-outliner", "extensions");
}
/**
 * Whether this process reads the user folder. A service pointed at another
 * legacy registry (a scratch or test service) reads it only when pointed at
 * a folder too, so it never picks up the owner's real extensions and secrets.
 */
export function userExtensionsFolderInUse(): boolean {
  return !(process.env.OUTLINER_RESOURCE_EXTENSIONS !== undefined && process.env.OUTLINER_EXTENSIONS_DIR === undefined);
}
function label(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
function failure(message: string): ResourceCatalogError {
  return new ResourceCatalogError(
    "source-unavailable",
    `Resource extension: ${message}`,
  );
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function boundedFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (file.size > MAX_CONFIG_BYTES)
    throw failure("configuration exceeds 64 KiB");
  return file.text();
}

/** What every extension process gets besides its request (PIE-754): no more than this, and no host secrets. */
export interface ExtensionProcessEnv {
  readonly [name: string]: string;
}

/**
 * The base environment: a PATH, a locale, the service user's HOME (a host CLI finds its login there: `gh`, `git`) and
 * WITH_SECRETS_DIR when the service has one. The manifest's `env` names, the connection and secrets are added per call.
 */
function baseEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8", HOME: process.env.HOME || homedir(),
    ...(process.env.WITH_SECRETS_DIR ? { WITH_SECRETS_DIR: process.env.WITH_SECRETS_DIR } : {}),
  };
}

/** How much of a failed process's stderr is shown: its last lines, this many characters at most. */
const STDERR_TAIL_LINES = 6;
const STDERR_TAIL_CHARS = 600;
const STDERR_KEPT_BYTES = 16 * 1024;

/** The last few lines of what a process wrote to stderr, one line each, escapes and control characters out. */
export function stderrTail(text: string): string {
  return plainText(text).split("\n").map((line) => line.trimEnd()).filter(Boolean).slice(-STDERR_TAIL_LINES).join(" | ").slice(-STDERR_TAIL_CHARS);
}

/** Terminal escapes and control characters (all but newline and tab) out. */
function plainText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** Process isolation provides deadlines and fresh code, not a sandbox. Only trusted installs may run. */
async function runCommand(
  command: readonly string[],
  cwd: string,
  input: string,
  timeoutMs: number,
  signal?: AbortSignal,
  env: Record<string, string> = baseEnv(),
  /** The call's secrets, read when it fails, so its stderr is scrubbed of every one (a group asked for while it ran too). */
  secrets: () => readonly string[] = () => [],
): Promise<string> {
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES)
    throw failure("request exceeds 256 KiB");
  if (signal?.aborted)
    throw failure(
      signal?.reason instanceof Error && signal.reason.name === "TimeoutError"
        ? "request timed out"
        : "request cancelled",
    );
  return new Promise((accept, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    const chunks: Buffer[] = [];
    // The end of stderr, kept only to say why a process failed (scrubbed, its last lines), never stored otherwise.
    let stderr = Buffer.alloc(0);
    let cut = false;
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > STDERR_KEPT_BYTES) {
        stderr = stderr.subarray(stderr.length - STDERR_KEPT_BYTES);
        cut = true;
      }
    });
    let length = 0,
      settled = false;
    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      kill();
      if (error) reject(error);
      else accept(Buffer.concat(chunks).toString("utf8"));
    };
    const abort = () =>
      finish(
        failure(
          signal?.reason instanceof Error &&
            signal.reason.name === "TimeoutError"
            ? "request timed out"
            : "request cancelled",
        ),
      );
    const timer = setTimeout(
      () => finish(failure("request timed out")),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () =>
      finish(failure("command could not start; check the installed manifest")),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_RESULT_BYTES) finish(failure("response exceeds 1 MiB"));
      else chunks.push(chunk);
    });
    child.stdin.on("error", () => {});
    child.on("close", (code, killed) => {
      if (code === 0) return finish();
      const tail = stderrTail(scrubCredentials(cut ? uncut(plainText(stderr.toString("utf8")), secrets()) : plainText(stderr.toString("utf8")), secrets()) as string);
      const how = code === null ? `was stopped (${killed ?? "a signal"})` : `exited with code ${code}`;
      finish(failure(`command ${how}${tail ? `: ${tail}` : " and wrote nothing to stderr"}`));
    });
    child.stdin.end(input);
  });
}

/**
 * The end of a stream that was cut to its last bytes: its first, partial line dropped, and any start that is the end of
 * a secret (cut through by the cut) redacted, so no piece of a value survives the scrub that follows.
 */
function uncut(text: string, secrets: readonly string[]): string {
  const newline = text.indexOf("\n");
  let rest = newline < 0 ? "" : text.slice(newline + 1);
  for (const form of secretForms(secrets)) {
    for (let length = form.length - 1; length > 0; length -= 1) {
      if (rest.startsWith(form.slice(-length))) { rest = `[redacted]${rest.slice(length)}`; break; }
    }
  }
  return rest;
}

/** One macOS Keychain item's password (`security find-generic-password -s <service> -w`), or undefined. */
export async function keychainItem(service: string, cwd = "/", timeoutMs = 3000): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  return (await runCommand(["/usr/bin/security", "find-generic-password", "-s", service, "-w"], cwd, "", timeoutMs).catch(() => "")).trim() || undefined;
}

/** The forms of a secret the scrub finds: as it is, base64 and URL-encoded; longest first. */
function secretForms(secrets: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    forms.add(secret);
    forms.add(Buffer.from(secret).toString("base64"));
    forms.add(encodeURIComponent(secret));
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

export function scrubCredentials(
  value: unknown,
  secrets: readonly string[],
  depth = 0,
): unknown {
  if (depth > 64) throw failure("response exceeds nesting limit");
  if (typeof value === "string") {
    if (!secrets.length) return value;
    // Escapes out first, so a value split by one ("ab\x1b[0mcd") is found whole; then each form of each value.
    value = plainText(value);
    for (const token of secretForms(secrets))
      value = (value as string).split(token).join("[redacted]");
    return value;
  }
  if (Array.isArray(value))
    return value.map((item) => scrubCredentials(item, secrets, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        scrubCredentials(key, secrets, depth + 1),
        scrubCredentials(item, secrets, depth + 1),
      ]),
    );
  return value;
}

/** The old single-file registry (`resource-extensions.json`); `OUTLINER_RESOURCE_EXTENSIONS` moves it. */
export function defaultRegistryPath(): string {
  return process.env.OUTLINER_RESOURCE_EXTENSIONS ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pi-herdr-outliner", "resource-extensions.json");
}

export interface ExtensionResult {
  readonly value: unknown;
  readonly adapter: { id: string; version: number };
  readonly manifestHash: string;
}

/** Where an extension's process reaches the service (PIE-754): the socket, and the outline it runs for. */
export interface ExtensionConnection {
  readonly socket?: string;
  readonly outline?: string;
}

/** Who a call is for: the change feed's label for what its process writes, and who asked for it. */
export interface ExtensionCallFor {
  /** `ext.<id>.<action>`; default `ext.<id>.<operation>`. */
  readonly label?: string;
  /** Whether its process may write over its connection (default: no, it only reads). */
  readonly writes?: boolean;
  readonly requestedBy?: MutationProvenance;
  /** Filled with what its process writes over its connection (the grant's `wrote`), for the caller to redraw. */
  readonly wrote?: { blockId?: string; parentId?: string | null; previousParentId?: string | null }[];
}

type ExtensionOperation = "resolve" | "read" | "changed" | "run" | "act" | "respond" | "decorate" | "bar";
/** What one call runs: the install, its manifest's part a call needs, its folder and stamp. */
interface InstalledCall {
  install: { manifest: string; enabled: boolean; config: Record<string, unknown>; credentials: Record<string, import("typebox").Static<typeof Credential> | { file: string } | { group: string; key: string }> };
  manifest: { contract: 1 | 2; id: string; version: number; command: readonly string[]; name: string; env?: readonly string[]; secretGroups?: readonly string[] };
  directory: string;
  stamp: string;
}

/** An extension's last call (`extensions.list`'s `lastRun`): when, which, and why it failed. */
export interface ExtensionRunStatus {
  readonly at: string;
  /** `ext.<id>.<action or handler>`, or the operation. */
  readonly call: string;
  readonly ok: boolean;
  /** Why it failed, scrubbed of its secrets: a crash's last stderr lines, a timeout, a refusal code. */
  readonly error?: string;
}

export class ResourceExtensionRuntime {
  private readonly runs = new Map<string, ExtensionRunStatus>();
  /** What an extension's last call did (absent before its first). */
  lastRun(extensionId: string): ExtensionRunStatus | undefined {
    return this.runs.get(extensionId);
  }
  constructor(
    readonly configPath = defaultRegistryPath(),
    readonly timeoutMs = 15_000,
    folders?: readonly string[],
  ) {
    const isolated = !userExtensionsFolderInUse();
    this.folders = folders ?? ((configPath === undefined || configPath === defaultRegistryPath()) && !isolated ? [userExtensionsDirectory()] : []);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw failure("deadline must be 1..60000 milliseconds");
  }
  /** Where contract 2 folders are looked up, nearest first (the outline's, then the user's). Empty: only the legacy registry. */
  folders: readonly string[];
  /** The service's socket and outline, given to every process this runtime starts (`EP0CH_SOCKET`, `EP0CH_WS`). */
  private connection: () => ExtensionConnection = () => ({});
  useConnection(connection: () => ExtensionConnection): void {
    this.connection = connection;
  }
  /**
   * Looks extensions up in these folders from now on, nearest first. The
   * service passes its registry's roots (`src/extension-registry.ts`), so a
   * folder in the outline's `extensions/` runs like one in the user folder.
   */
  useFolders(folders: readonly string[]): void {
    this.folders = [...folders];
  }
  private async folderInstallation(provider: string) {
    for (const root of this.folders) {
      const directory = join(root, provider);
      if (!(await Bun.file(join(directory, "extension.json")).exists())) continue;
      let loaded;
      try {
        loaded = await readExtensionFolder(directory, root === userExtensionsDirectory() ? "user" : "outline");
      } catch (error) {
        // The same words `outliner ext ls` and `extensions.list` show, naming the file and the field.
        throw failure(`${provider} extension in ${directory} is invalid: ${error instanceof ExtensionLoadError ? error.message : "it could not be read"}`);
      }
      if (!loaded.enabled) throw failure(`${loaded.name} is disabled in ${join(directory, "config.json")}`);
      if (!loaded.command) throw failure(`${loaded.name} runs no code (its extension.json has no run)`);
      return {
        install: { manifest: join(directory, "extension.json"), enabled: true, config: loaded.config, credentials: loaded.credentials },
        manifest: { contract: 2 as const, id: loaded.id, version: loaded.version, command: loaded.command, name: loaded.name },
        description: {
          id: loaded.id, name: loaded.name, version: loaded.version, contract: 2 as const, directory,
          handlers: loaded.manifest.handlers ?? [], sources: loaded.sources, origin: loaded.origin,
        } satisfies ExtensionDescription,
        directory,
        stamp: loaded.stamp,
        loaded,
      };
    }
    return null;
  }
  /**
   * The providers the legacy single-file registry (`resource-extensions.json`, contract 1) installs and enables: each
   * an extension id whose Resources it serves (Jira's, before its folder). Empty when there is no such file.
   */
  async legacyProviders(): Promise<string[]> {
    try {
      const registry = Parse(Registry, JSON.parse(await boundedFile(this.configPath)));
      return Object.entries(registry.providers).filter(([, install]) => install.enabled).map(([provider]) => provider);
    } catch {
      return [];
    }
  }
  /** The installed extension for a provider key, without running it; null when none is installed. */
  async describe(provider: string): Promise<ExtensionDescription | null> {
    const folder = await this.folderInstallation(provider);
    if (folder) return folder.description;
    try {
      const legacy = await this.installation(provider);
      return {
        id: legacy.manifest.id, name: label(provider), version: legacy.manifest.version, contract: 1,
        directory: legacy.directory, handlers: [{ key: provider, kind: "resource", effects: "read" }], sources: [],
      };
    } catch {
      return null;
    }
  }
  private async installation(provider: string) {
    const folder = await this.folderInstallation(provider);
    if (folder) return folder;
    try {
      const raw = await boundedFile(this.configPath);
      const registry = Parse(Registry, JSON.parse(raw));
      const install = registry.providers[provider];
      if (!install || !install.enabled)
        throw failure(
          `no ${label(provider)} extension on this machine: ${provider} is not installed or is disabled (add ${join(userExtensionsDirectory(), provider)} or configure resource-extensions.json)`,
        );
      if (!isAbsolute(install.manifest))
        throw failure("manifest path must be absolute");
      const manifestRaw = await boundedFile(install.manifest);
      const manifest = Parse(Manifest, JSON.parse(manifestRaw));
      if (
        !IsSchema(manifest.configSchema) ||
        !Compile(manifest.configSchema).Check(install.config)
      )
        throw failure("extension configuration does not match its schema");
      return {
        install,
        manifest: { ...manifest, name: label(provider) },
        directory: dirname(install.manifest),
        stamp: hash(JSON.stringify(install) + manifestRaw),
      };
    } catch (error) {
      if (error instanceof ResourceCatalogError) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        throw failure(`no ${label(provider)} extension on this machine (add ${join(userExtensionsDirectory(), provider)})`);
      throw failure(
        `${provider} installation is unavailable or invalid; check manifest contract 1 and configuration`,
      );
    }
  }
  /**
   * One call: one process, one JSON request on stdin, one response on stdout.
   * `resolve`, `read` and `changed` are the Resource operations (contract 1);
   * `run` (an output or component handler) and `act` (an action) are contract
   * 2's. `deadlineMs` is the manifest's (at most 5 minutes); the runtime's own
   * deadline otherwise.
   */
  async invoke(
    provider: string,
    operation: "resolve" | "read" | "changed" | "run" | "act",
    input: unknown,
    signal?: AbortSignal,
    deadlineMs?: number,
  ): Promise<ExtensionResult> {
    const installed = await this.installation(provider);
    // Disable/config changes during a call invalidate its result before the catalog can commit it.
    return this.invokeInstalled(provider, installed, operation, input, signal, deadlineMs, {},
      async () => (await this.installation(provider)).stamp === installed.stamp);
  }

  /**
   * One call to the version the registry serves (`src/extension-registry.ts`):
   * a folder whose manifest broke since keeps running its last good manifest
   * and config, as `extensions.list` says. Code is still read fresh. Its
   * folder is read again when the call answers: an extension disabled,
   * removed or changed while it ran has its answer discarded (`stamp`), so
   * nothing it returned is kept or written.
   */
  async invokeLoaded(
    extension: LoadedExtension,
    operation: "read" | "run" | "act" | "respond" | "decorate" | "bar",
    input: unknown,
    deadlineMs?: number,
    callFor: ExtensionCallFor = {},
  ): Promise<ExtensionResult> {
    if (!extension.command) throw failure(`${extension.name} runs no code (its extension.json has no run)`);
    if (!extension.enabled) throw failure(`${extension.name} is disabled in ${join(extension.directory, "config.json")}`);
    const before = await folderStamp(extension.directory);
    return this.invokeInstalled(extension.id, {
      install: { manifest: join(extension.directory, "extension.json"), enabled: true, config: extension.config, credentials: extension.credentials },
      manifest: { contract: 2 as const, id: extension.id, version: extension.version, command: extension.command, name: extension.name,
        env: extension.manifest.env ?? [], secretGroups: extension.manifest.secretGroups ?? [] },
      directory: extension.directory,
      stamp: extension.stamp,
    }, operation, input, undefined, deadlineMs, callFor, async () => {
      const after = await folderStamp(extension.directory);
      // Removed, or edited while it ran.
      if (after === null || after !== before) return false;
      if (after === extension.stamp) return true;
      // Changed before the call and not reloaded yet: a broken manifest (or one past the read limit) keeps its last good
      // copy; a disabled one still ran, and its answer is discarded.
      try {
        return (await readExtensionFolder(extension.directory, extension.origin)).enabled;
      } catch {
        return true;
      }
    });
  }

  private async invokeInstalled(
    provider: string,
    loaded: InstalledCall,
    operation: ExtensionOperation,
    input: unknown,
    signal: AbortSignal | undefined,
    deadlineMs: number | undefined,
    callFor: ExtensionCallFor,
    /** Whether the extension is still the one that was called, asked once it answers. */
    unchanged: () => Promise<boolean>,
  ): Promise<ExtensionResult> {
    const call = callFor.label ?? `ext.${loaded.manifest.id}.${operation}`;
    try {
      const result = await this.invokeProcess(provider, loaded, operation, input, signal, deadlineMs, callFor, unchanged);
      this.runs.set(loaded.manifest.id, { at: new Date().toISOString(), call, ok: true });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message.replace(/^Resource extension: /, "") : String(error);
      this.runs.set(loaded.manifest.id, { at: new Date().toISOString(), call, ok: false, error: reason });
      throw error;
    }
  }

  private async invokeProcess(
    provider: string,
    loaded: InstalledCall,
    operation: ExtensionOperation,
    input: unknown,
    signal: AbortSignal | undefined,
    deadlineMs: number | undefined,
    callFor: ExtensionCallFor,
    unchanged: () => Promise<boolean>,
  ): Promise<ExtensionResult> {
    const deadline = Math.min(MAX_DEADLINE_MS, deadlineMs ?? this.timeoutMs);
    signal = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(deadline),
    ]);
    const secrets: Record<string, string> = {};
    // A with-secrets key also reaches the process as its own variable (READWISE_TOKEN), only that one, only here.
    const secretEnv: Record<string, string> = {};
    for (const [name, reference] of Object.entries(
      loaded.install.credentials,
    )) {
      let value: string | undefined;
      if ("group" in reference) {
        try {
          value = await readGroupSecret(reference.group, reference.key, `${loaded.manifest.name}'s ${name} secret`, process.platform === "darwin"
            ? (service) => keychainItem(service, loaded.directory, Math.min(this.timeoutMs, 3000))
            : undefined);
        } catch (error) {
          throw failure(error instanceof Error ? error.message : String(error));
        }
        secretEnv[reference.key] = value;
      }
      else if ("env" in reference) value = process.env[reference.env];
      else if ("file" in reference) {
        // Say what is wrong with the file (where it is, its mode or size), never what is in it.
        const path = reference.file.replace(/^~(?=\/)/, homedir());
        const file = Bun.file(path);
        let mode: number;
        try {
          mode = (await file.stat()).mode;
        } catch {
          throw failure(`no ${loaded.manifest.name} credentials on this machine: the ${name} secret's file ${path} can't be read (missing, or not yours)`);
        }
        if (mode & 0o077) {
          throw failure(`${loaded.manifest.name}'s ${name} secret file ${path} is readable by others (mode ${(mode & 0o777).toString(8).padStart(3, "0")}); chmod 600 it`);
        }
        if (file.size > 16 * 1024) throw failure(`${loaded.manifest.name}'s ${name} secret file ${path} is larger than 16 KiB; a secret file holds only the secret`);
        try {
          value = (await file.text()).trim();
        } catch {
          throw failure(`no ${loaded.manifest.name} credentials on this machine: the ${name} secret's file ${path} can't be read`);
        }
        if (!value) throw failure(`${loaded.manifest.name}'s ${name} secret file ${path} is empty`);
      }
      else if (process.platform === "darwin") {
        const command = [
          "/usr/bin/security",
          "find-generic-password",
          "-s",
          reference.keychainService,
          ...(reference.account ? ["-a", reference.account] : []),
          "-w",
        ];
        try {
          value = (
            await runCommand(
              command,
              loaded.directory,
              "",
              Math.min(this.timeoutMs, 3000),
              signal,
            )
          ).trim();
        } catch {
          throw failure(`no ${loaded.manifest.name} credentials on this machine (${provider} credentials are unavailable)`);
        }
      }
      if (!value?.trim())
        throw failure(`no ${loaded.manifest.name} credentials on this machine (${provider} credentials are unavailable)`);
      secrets[name] = value;
    }
    const request = JSON.stringify({
      contract: loaded.manifest.contract,
      operation,
      input,
      config: loaded.install.config,
      credentials: secrets,
    });
    // Its connection to the service (PIE-754): the socket, the outline, and a grant that makes what it writes there
    // the extension's own (`ext:<id>`), valid while this process runs.
    const connection = this.connection();
    // One list for the whole call: a group it asks for while it runs (`secrets.group`) joins it, so its answer, its
    // writes and its stderr are scrubbed of those values too.
    const secretValues = Object.values(secrets);
    const grant = issueGrant({
      extensionId: loaded.manifest.id,
      label: callFor.label ?? `ext.${loaded.manifest.id}.${operation}`,
      writes: callFor.writes === true,
      secrets: secretValues,
      ...(loaded.manifest.secretGroups?.length ? { secretGroups: loaded.manifest.secretGroups } : {}),
      ...(callFor.wrote ? { wrote: callFor.wrote } : {}),
      ...(callFor.requestedBy ? { requestedBy: callFor.requestedBy } : {}),
    });
    // The host variables its manifest names (`env`), when the service has them: never a secret's place.
    const passed: Record<string, string> = {};
    for (const name of loaded.manifest.env ?? []) {
      const value = process.env[name];
      if (value !== undefined && !RESERVED_EXTENSION_ENV.has(name)) passed[name] = value;
    }
    const env: Record<string, string> = {
      ...passed,
      ...secretEnv,
      ...baseEnv(),
      OUTLINER_EXTENSION: loaded.manifest.id,
      EP0CH_EXT_GRANT: grant,
      ...(connection.socket ? { EP0CH_SOCKET: connection.socket } : {}),
      ...(connection.outline ? { EP0CH_WS: connection.outline } : {}),
    };
    let output: string;
    try {
      output = await runCommand(
        loaded.manifest.command,
        loaded.directory,
        request,
        deadline,
        signal,
        env,
        () => secretValues,
      );
    } finally {
      revokeGrant(grant);
    }
    if (!(await unchanged()))
      throw failure(`${loaded.manifest.name} was changed, disabled or removed while it ran; its answer was discarded (refresh to retry)`);
    let envelope: unknown;
    try {
      envelope = JSON.parse(output);
    } catch {
      throw failure("command returned invalid JSON");
    }
    let parsed;
    try {
      parsed = Parse(
        Type.Union([
          Type.Object(
            { ok: Type.Literal(true), value: Type.Unknown() },
            { additionalProperties: false },
          ),
          Type.Object(
            { ok: Type.Literal(false), code: Type.String() },
            { additionalProperties: false },
          ),
        ]),
        envelope,
      );
    } catch {
      throw failure("command returned an invalid response envelope");
    }
    if (!parsed.ok)
      throw failure(parsed.code === "credentials-missing"
        ? `no ${loaded.manifest.name} credentials on this machine`
        : ERROR_MESSAGES[parsed.code] ?? "provider operation failed");
    return {
      value: scrubCredentials(parsed.value, secretValues),
      adapter: { id: loaded.manifest.id, version: loaded.manifest.version },
      manifestHash: loaded.stamp,
    };
  }
}
