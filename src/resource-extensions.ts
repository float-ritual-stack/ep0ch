import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { Type, IsSchema } from "typebox";
import { Parse } from "typebox/value";
import { Compile } from "typebox/compile";
import { ResourceCatalogError } from "./resources";

const Credential = Type.Union([
  Type.Object(
    { env: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      keychainService: Type.String({ minLength: 1, maxLength: 200 }),
      account: Type.Optional(Type.String({ maxLength: 200 })),
    },
    { additionalProperties: false },
  ),
]);
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
};
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

/** Process isolation provides deadlines and fresh code, not a sandbox. Only trusted installs may run. */
async function runCommand(
  command: readonly string[],
  cwd: string,
  input: string,
  timeoutMs: number,
  signal?: AbortSignal,
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
      stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
    });
    const chunks: Buffer[] = [];
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
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : failure("command failed; check extension configuration"),
      ),
    );
    child.stdin.end(input);
  });
}

function scrubCredentials(
  value: unknown,
  secrets: readonly string[],
  depth = 0,
): unknown {
  if (depth > 64) throw failure("response exceeds nesting limit");
  if (typeof value === "string") {
    for (const secret of secrets)
      for (const token of [secret, Buffer.from(secret).toString("base64")])
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

export interface ExtensionResult {
  readonly value: unknown;
  readonly adapter: { id: string; version: number };
  readonly manifestHash: string;
}
export class ResourceExtensionRuntime {
  constructor(
    readonly configPath = process.env.OUTLINER_RESOURCE_EXTENSIONS ??
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "pi-herdr-outliner",
        "resource-extensions.json",
      ),
    readonly timeoutMs = 15_000,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw failure("deadline must be 1..60000 milliseconds");
  }
  private async installation(provider: string) {
    try {
      const raw = await boundedFile(this.configPath);
      const registry = Parse(Registry, JSON.parse(raw));
      const install = registry.providers[provider];
      if (!install || !install.enabled)
        throw failure(
          `${provider} is not installed or is disabled; configure resource-extensions.json`,
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
        manifest,
        directory: dirname(install.manifest),
        stamp: hash(JSON.stringify(install) + manifestRaw),
      };
    } catch (error) {
      if (error instanceof ResourceCatalogError) throw error;
      throw failure(
        `${provider} installation is unavailable or invalid; check manifest contract 1 and configuration`,
      );
    }
  }
  async invoke(
    provider: string,
    operation: "resolve" | "read",
    input: unknown,
    signal?: AbortSignal,
  ): Promise<ExtensionResult> {
    signal = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(this.timeoutMs),
    ]);
    const loaded = await this.installation(provider);
    const secrets: Record<string, string> = {};
    for (const [name, reference] of Object.entries(
      loaded.install.credentials,
    )) {
      let value: string | undefined;
      if ("env" in reference) value = process.env[reference.env];
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
          throw failure(`${provider} credentials are unavailable`);
        }
      }
      if (!value?.trim())
        throw failure(`${provider} credentials are unavailable`);
      secrets[name] = value;
    }
    const request = JSON.stringify({
      contract: 1,
      operation,
      input,
      config: loaded.install.config,
      credentials: secrets,
    });
    const output = await runCommand(
      loaded.manifest.command,
      loaded.directory,
      request,
      this.timeoutMs,
      signal,
    );
    // Disable/config changes during a call invalidate its result before the catalog can commit it.
    if ((await this.installation(provider)).stamp !== loaded.stamp)
      throw failure("configuration changed during request; refresh to retry");
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
      throw failure(ERROR_MESSAGES[parsed.code] ?? "provider operation failed");
    return {
      value: scrubCredentials(parsed.value, Object.values(secrets)),
      adapter: { id: loaded.manifest.id, version: loaded.manifest.version },
      manifestHash: loaded.stamp,
    };
  }
}
