# Resource extensions: bounded reconnaissance

2026-09-25. Primary-source reading only; no upstream software executed, credentials accessed, or laptop changes made. All three repositories were accessible. This is evidence for PIE-380/381, not a proposal to adopt another harness.

## Recommendation

Build a small **installed Resource adapter contract**, with the Outliner service retaining canonical identity, snapshots, revision checks, annotations, persistence, and user-visible errors. Move Jira request/authentication/response conversion into the first independent adapter. Remove the unusable built-in Jira implementation immediately, as authorized; no staged rollout or preservation of its executable implementation is needed.

Take three ideas: bb's independently usable SDK boundary; Cordis's ownership and disposal of registrations; OpenCode's rebuilding derived registries from active contributions. Do not make the whole Outliner pluggable or import their orchestration frameworks.

## Pinned reading

| Project | Inspected revision | Most relevant evidence |
|---|---|---|
| get-bb/bb | `90971b15973b3e182d4086c1214456879da06860` | Public SDK, forkability checks, plugin activation and reload |
| deepseek-ai/deepseek-harness | `477b4f420553e8a52c2fbccc464d7561b239c443` | Cordis effects, lifecycle, config-only versus module HMR, credentials |
| anomalyco/opencode | `adee738d1e4597a2d0d317ca61a1625eff289efa` | V2 State/Plugin runtime, external loader, older loader contrasts |
| OpenCode Reloaded | Retrieved 2026-09-25; unversioned essay | Design explanation checked against source, not assumed universal release behavior |

Local read-only clones: `/tmp/outliner-plugin-recon/{bb,deepseek-harness,opencode}`. A pinned source tree proves code exists at that revision; this reconnaissance did not establish which published application releases enable each path.

## What each project actually offers

### bb: make the boundary demonstrably portable

bb's package manifest declares `bb.server`, optional app/host entrypoints, and SDK compatibility. Its forkable-plugin policy requires selected built-ins to work when copied out of the repository using the public SDK and public dependencies; lint rejects private workspace imports and CI performs the external-copy build. That is a stronger acceptance test than moving Jira into an `extensions/` directory. Plugin IDs are reserved against accidental built-in shadowing. [Manifest](https://github.com/get-bb/bb/blob/90971b15973b3e182d4086c1214456879da06860/packages/domain/src/plugin-manifest.ts), [forkability contract](https://github.com/get-bb/bb/blob/90971b15973b3e182d4086c1214456879da06860/docs/forkable-plugins.md), [registration](https://github.com/get-bb/bb/blob/90971b15973b3e182d4086c1214456879da06860/apps/server/src/services/plugins/plugin-registration.ts).

Its runtime loads a factory into the server using Jiti, owns registrations, time-boxes startup/services, and disposes contributions. Local modules get a new load generation. Failed candidate loads can retain the previous running instance while exposing `reload failed`; services needing configuration stop retrying until reload. This is lifecycle robustness, **not evidence of an OS sandbox**: the inspected server factory runs in-process. A global safe mode can suppress external plugins. [Runtime](https://github.com/get-bb/bb/blob/90971b15973b3e182d4086c1214456879da06860/apps/server/src/services/plugins/plugin-runtime.ts).

Settings distinguish secret descriptors; secrets use separate files and public settings views expose only whether each is set. Activation includes state snapshots and rollback machinery, useful background but excessive for our first read-only Jira adapter. [Settings](https://github.com/get-bb/bb/blob/90971b15973b3e182d4086c1214456879da06860/apps/server/src/services/plugins/plugin-settings.ts), [activation](https://github.com/get-bb/bb/blob/90971b15973b3e182d4086c1214456879da06860/apps/server/src/services/plugins/plugin-activation.ts).

### DeepSeek Harness: every effect needs an owner

A host plugin can be a small JS package with a YAML composition patch and `apply(ctx, config)`. Config schemas validate activation. Effects/events belong to the plugin and return cleanup. Cordis makes lifecycle states explicit: pending dependencies, loading, active, failed, unloading, disposed; disposers run in reverse order and async disposal is awaited. Dependency injection and composition scopes are useful organizational boundaries, not proof of security isolation. [Host-plugin contract](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md), [actual lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/vendor/cordis/src/fiber.ts).

The HMR package serializes config/module changes, debounces writes, and cleans up watchers. Crucial limitation: the base setup enables **config-only** HMR; headless/SDK/ACP profiles disable it. Module watching is opt-in and uses Node loader internals. Replacing installed package versions still requires restart. Do not translate “everything is a plugin” into “everything reloads safely without restart.” [HMR implementation guide](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/hmr/README.md), [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/architecture.md).

Credential references separate secret lookup from configuration. `describe` reports presence/source/writability without values, while `resolve` retrieves current material for a request. Its local credential store explicitly admits same-user agent processes can read its files; file permissions do not isolate credentials from that agent. This honesty is worth copying. [Credential seam](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/credentials/credentials/README.md), [local store limits](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/credentials/credentials-local/README.md), [safety notice](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/SAFETY.md).

### OpenCode: regenerate derived state instead of accumulating patches

The essay's central idea is replaying registered transformations from a fresh base whenever contributions change. Removing a plugin removes its contributions. This avoids repeated destructive modifications such as halving an already-halved value. It also describes agent-authored plugins immediately becoming usable; that is the author's claim about the experience, not a security boundary. [OpenCode Reloaded](https://anoma.ly/notes/opencode-reloaded/).

The core V2 `State` code implements scoped transforms, serialized rebuilds, and publication after finalization. `Plugin` owns one scope per plugin ID, batches reloads during disposal/replacement, detects load cycles, and records activation failures. These are real implementation patterns to borrow for a Resource-handler registry. Notably, replacement closes the old scope first; it is not bb-style keep-the-old-instance-on-every-failure. [State](https://github.com/anomalyco/opencode/blob/adee738d1e4597a2d0d317ca61a1625eff289efa/packages/core/src/state.ts), [V2 plugin runtime](https://github.com/anomalyco/opencode/blob/adee738d1e4597a2d0d317ca61a1625eff289efa/packages/core/src/plugin.ts), [Promise API](https://github.com/anomalyco/opencode/blob/adee738d1e4597a2d0d317ca61a1625eff289efa/packages/plugin/src/v2/promise/README.md).

Caution: the inspected V2 external loader scans configured packages and local files then imports them; it catches load causes without reporting them there. The older loader explicitly distinguishes install/entry/compatibility/load failures and says failed Bun imports remain cached for the process. Therefore the essay does not establish blanket file-change reload guarantees for every loader/release. The official threat model explicitly says permissions are a UX feature, not sandboxing. [V2 external loader](https://github.com/anomalyco/opencode/blob/adee738d1e4597a2d0d317ca61a1625eff289efa/packages/core/src/config/plugin/external.ts), [older loader](https://github.com/anomalyco/opencode/blob/adee738d1e4597a2d0d317ca61a1625eff289efa/packages/opencode/src/plugin/loader.ts), [security model](https://github.com/anomalyco/opencode/blob/adee738d1e4597a2d0d317ca61a1625eff289efa/SECURITY.md).

## Smallest Outliner implementation seam

These are recommendations/inferences, not upstream claims.

1. **Two narrow roles, one installation lifecycle.** A provider resolves a locator and fetches a bounded observation; a representation handler converts supplied bytes/document data into supported readable output. Jira is the first provider. A Pi JSONL reader later exercises the representation role without inheriting network credentials or canonical-write access. Do not require both roles in every extension.
2. **One small manifest.** Stable extension ID, contract version, entrypoint/command, declared provider or media handlers, config schema. Reject duplicate handlers visibly rather than letting load order silently determine meaning. No marketplace, dependency solver, arbitrary UI renderer, or user-code migrations yet.
3. **Execution tradeoff is explicit.** Trusted local modules are smallest to load but can hang/crash the service and access process secrets. A subprocess JSON request/result contract costs serialization and process startup, but gives enforceable timeout/kill and fresh-code reload. For canonical-service reliability, prefer the subprocess for this pilot if the current host already supports command execution. It is still same-user trusted code, **not a sandbox**. Pass a selected environment and only relevant config/credentials; no DB handle.
4. **Explicit reload first.** Load/validate a candidate generation, publish only a valid registration set, fence late results from removed generations, and cancel bounded requests on unload. A bad candidate must produce a visible failed-load state. File watching can wait. “No rebuild” need not mean a whole HMR framework.
5. **Source config is data; credentials stay runtime-local.** Store origin/project/auth mode plus a credential reference. Jira extension owns Basic-vs-Bearer construction. Host diagnostics show configured/missing/failed, never the secret. A laptop keychain reference is resolved on that laptop; float-box cannot magically read it. No credential copying or laptop deployment is part of this batch.
6. **Service owns commitment.** Validate output size/schema, revision/identity, terminal-safe presentation and permission boundaries before persisting observations. Preserve raw source material and adapter ID/version/digest for reproducibility; extensions do not rewrite notes or annotations directly.

The existing code already has an injectable `RemoteEntityProviderClient` with `observe`, `execute`, optional `resolveLocator`, and an injected credential resolver. The catalog owns source snapshots/representations and currently constructs the default client. That is a useful extraction starting point. However provider unions and command schemas still hard-code Jira/Linear: moving only the HTTP function would not produce a genuine extensible boundary. Local references: `src/remote-entity.ts:45`, `src/resource-catalog.ts:969`, `src/resources.ts:34`, `src/resources.ts:650`. Jira Bearer headers are directly visible at `src/remote-entity.ts:690` and nearby paths. The user's Bearer→403/Basic→200 test is reported field evidence, not independently rerun here.

## Acceptance checks worth adding to PIE-380/381

- Install the Jira adapter from a directory outside the Outliner checkout; it imports no private Outliner source and works without rebuilding the application.
- Remove built-in Jira immediately. Before adapter installation, explicit Jira references show “extension unavailable/install Jira” instead of silently becoming links to the wrong target. Do not delete unrelated notes or retained observations.
- Reload changed adapter code, then prove the new version handled the next request; no stale import success claim. Exercise a missing entrypoint, incompatible contract, malformed response, oversized response, timeout, and unload during an in-flight request through a focused boundary test suite.
- Configure a fake Jira HTTP fixture for Basic and Bearer modes; assert credentials do not enter stored documents, logs, or exported errors. Live Rexall acceptance waits for the user's laptop deployment window.
- Confirm rendering and activation use the same registry resolution, and ordinary local `[[PC-762]]` page navigation stays independent of explicit Jira Resource activation.
- Keep registry/installation diagnostics navigable in the Outliner. Record exactly what was tested locally and what still needs laptop/Rexall validation.

## Defer

Self-modification is ordinary editable extension source plus an authorized reload. It must not silently widen its own permission/configuration or write canonical state by escaping the service API. Marketplace management, automatic installation, complex dependency injection, generic UI plugins, and full reactive transform infrastructure need second concrete callers. The transcript reader is the next useful test of reuse; it should not delay getting Jira out of core.
