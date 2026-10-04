import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createOutlinerClient } from "./client";
import { listLiveClients, sendClientCommand } from "./client-target";
import {
  invocationPaneRoot,
  selectLinkedDetailClient,
  selectTreeClientForInvocation,
} from "./herdr-open-policy";
import {
  pluginInvocationPaneId,
  pluginInvocationWorkspaceRootSource,
  type PaneEntrypoint,
} from "./pane-control";
import { OUTLINE_ENV, remoteHint, resolveClientPaths } from "./paths";
import { attachHostedOutline, attachNamedOutline, resolveInvocationPaths, waitForOutlineHost } from "./outline-host-client";
import type { OutlineChooserContext } from "./outline-chooser";
import { waitForCompatibleService } from "./service-compatibility";
import {
  clientSupportsRole,
  type OutlinerClientRegistration,
  type NavigationLinkState,
} from "./types";

import { reportStartupErrors } from "./startup-error";
import { colourOnlyToATerminal } from "./plain-stderr";
// Piped stderr stays plain: the Claude mod, door-open and tests parse these refusals.
colourOnlyToATerminal();

// A program asking (no focus, or only finding): it says any failure itself.
const callerReports = process.argv.includes("--no-focus") || process.argv.includes("find-detail");

await reportStartupErrors(async () => {
  interface OpenPaneResponse {
    result?: { plugin_pane?: { pane?: { pane_id?: string } } };
  }

  interface PaneDetailsResponse {
    result?: {
      pane?: {
        pane_id?: string;
        label?: string;
        foreground_cwd?: string;
        cwd?: string;
        workspace_id?: string;
        tab_id?: string;
      };
    };
  }

  const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
  const pluginId = process.env.HERDR_PLUGIN_ID ?? "float.pi-outliner";
  const currentPaneId = pluginInvocationPaneId();
  const HERDR_SYNC_TIMEOUT_MS = 2_000;
  const modeArgument = process.argv.indexOf("--mode");
  const mode =
    modeArgument < 0
      ? "focus-or-open"
      : process.argv[modeArgument + 1];
  if (
    mode !== "focus-or-open" &&
    mode !== "ensure-detail" &&
    mode !== "find-detail" &&
    mode !== "open-here" &&
    mode !== "open-tree" &&
    mode !== "open-composed" &&
    mode !== "focus-existing" &&
    mode !== "service-only" &&
    mode !== "choose-outline"
  ) {
    throw new Error(`Invalid outliner open mode: ${String(mode)}`);
  }
  const clientArgument = process.argv.indexOf("--client");
  const requestedClientId =
    clientArgument < 0 ? undefined : process.argv[clientArgument + 1];
  if (clientArgument >= 0 && !requestedClientId) {
    throw new Error("--client requires a client ID");
  }
  if (
    requestedClientId &&
    (mode === "open-tree" || mode === "open-here" || mode === "open-composed" || mode === "service-only" || mode === "choose-outline")
  ) {
    throw new Error(`--client cannot be used with --mode ${mode}`);
  }
  // `--no-focus`: ensure-detail for a caller beside the person (Claude's mentions), never moving their keys.
  const focus = !process.argv.includes("--no-focus");
  if (!focus && mode !== "ensure-detail") throw new Error(`--no-focus is only for --mode ensure-detail`);
  if (process.env.HERDR_ENV !== "1") throw new Error("The outliner workspace action must run inside Herdr");

  // The outline chooser continues an open with the folder it was asked about.
  const chosenRoot = process.env.OUTLINER_OPEN_WORKSPACE_ROOT?.trim();
  const invocationRoot = pluginInvocationWorkspaceRootSource();
  let workspaceRoot = chosenRoot || invocationRoot.root;
  let rootSource = chosenRoot
    ? "the folder the outline chooser was opened for"
    : { pane: "the invoking pane's directory", workspace: "the Herdr workspace root", fallback: "the launcher's working directory" }[invocationRoot.source];
  let invocationPane: NonNullable<PaneDetailsResponse["result"]>["pane"];
  if (currentPaneId) {
    const paneOutput = execFileSync(herdr, ["pane", "get", currentPaneId], {
      encoding: "utf8",
      timeout: HERDR_SYNC_TIMEOUT_MS,
    });
    invocationPane = (JSON.parse(paneOutput) as PaneDetailsResponse).result?.pane;
    // Outliner panes report their project through OSC 7; their running process
    // remains in the plugin checkout. A new Tree must inherit the project.
    const picked = chosenRoot ? undefined : invocationPaneRoot(invocationPane, mode, resolve(import.meta.dir, ".."));
    if (picked) {
      workspaceRoot = picked.root;
      rootSource = `the invoking pane's ${picked.field}`;
    }
  }

  // An action invoked from an outliner pane stays on the outline that pane is on,
  // even after its folder was rebound or when the pane was opened by name alone.
  // The chooser's continuation and the switcher resolve the folder afresh.
  let paneOutline: string | undefined;
  if (currentPaneId && !chosenRoot && mode !== "choose-outline" && mode !== "service-only") {
    const invoked = await resolveInvocationPaths({ ...process.env, OUTLINER_WORKSPACE_ROOT: workspaceRoot }, currentPaneId, mode === "find-detail" ? 2_000 : undefined);
    if (invoked.outlineSource === "pane") paneOutline = invoked.outline;
  }
  const resolved = resolveClientPaths({ ...process.env, OUTLINER_WORKSPACE_ROOT: workspaceRoot, ...(paneOutline ? { EP0CH_WS: paneOutline } : {}) });
  // Nothing names an outline here (no EP0CH_WS, no .ep0ch): ask, never guess. The switcher always asks.
  if (!resolved.outline || mode === "choose-outline") {
    if (mode === "service-only" || mode === "find-detail") {
      throw new Error(`No outline for ${resolved.workspaceRoot} (resolved from ${rootSource}). ${resolved.unnamed ? `${resolved.unnamed}. ` : ""}Open the Outliner from Herdr in that folder to choose, create or import one.`);
    }
    const context: OutlineChooserContext = {
      mode: mode === "choose-outline" ? "open-here" : mode,
      workspaceRoot: resolved.workspaceRoot,
      rootSource,
      ...(resolved.guess ? { guess: resolved.guess } : {}),
      ...(mode === "choose-outline" ? { switch: true } : {}),
      // Switching in a folder that names one: the choice replaces that folder's .ep0ch.
      ...(mode === "choose-outline" && resolved.configPath ? { dotFolder: dirname(resolved.configPath) } : {}),
      ...(currentPaneId ? { paneId: currentPaneId } : {}),
      ...(requestedClientId ? { clientId: requestedClientId } : {}),
    };
    const args = [
      "plugin", "pane", "open", "--plugin", pluginId, "--entrypoint", "choose-outline",
      "--env", `OUTLINER_WORKSPACE_ROOT=${resolved.workspaceRoot}`,
      "--env", `OUTLINER_CHOOSER_CONTEXT=${JSON.stringify(context)}`,
      "--focus",
    ];
    for (const name of [...OUTLINE_ENV.filter(name => name !== "EP0CH_WS"), "OUTLINER_KEYBINDINGS_PATH", "XDG_CONFIG_HOME"]) {
      if (process.env[name] !== undefined) args.push("--env", `${name}=${process.env[name]}`);
    }
    execFileSync(herdr, args, { stdio: "ignore", timeout: HERDR_SYNC_TIMEOUT_MS });
    process.stdout.write(`${JSON.stringify({ outline: mode === "choose-outline" ? "switch" : "missing", chooser: "choose-outline", workspaceRoot: resolved.workspaceRoot, rootSource })}\n`);
    return;
  }
  const paths: typeof resolved = paneOutline ? { ...resolved, outlineSource: "pane" } : resolved;
  // A session attaches to its outline by name, creating it when its .ep0ch or EP0CH_WS names one nobody made yet
  // (like `tmux new -A`); the host itself is a service of its own (systemd, launchd).
  const name = paths.outline!;
  // A host that is restarting comes back: wait for it (longer for another machine's), never fall back.
  // find-detail asks in the background: a host that isn't there is "none found" soon, not a long wait.
  const host = await waitForOutlineHost({ ...process.env, OUTLINER_WORKSPACE_ROOT: workspaceRoot }, mode === "find-detail" ? 2_000 : paths.mode === "remote" ? 60_000 : 15_000);
  if (!host) {
    throw new Error(paths.mode === "remote"
      ? `No outline host answers at ${paths.socket}${paths.machine ? ` (on ${paths.machine})` : " (EP0CH_SOCKET)"}. ${remoteHint(paths)}`
      : `No outline host answers at ${paths.socket} (outline "${name}" for ${workspaceRoot}). The host runs as a service: systemctl --user start outliner-host (Linux), launchctl kickstart gui/$(id -u)/io.ep0ch.outliner-host (macOS), or bun packages/outliner/src/host-main.ts.`);
  }
  // Only the modes that open panes create a missing outline: Pi's `service-only` check, `focus-existing` and
  // `find-detail` open nothing, so they only attach. And only on this machine (PIE-545): on another machine a name
  // nobody has there is refused with what to run, never made (a typo, or a name meant for this machine, would make an
  // empty outline there). Making one there is said on purpose: `ep0ch outline create <name> --machine <m>`.
  const opensPanes = mode !== "service-only" && mode !== "focus-existing" && mode !== "find-detail";
  const attachment = opensPanes
    ? await attachNamedOutline(host, name, { ...(paths.machine ? { machine: paths.machine } : {}), createCommand: `ep0ch outline create ${name}${paths.machine ? ` --machine ${paths.machine}` : ""}` })
    : await attachHostedOutline(host, name, false);
  const attached = { name, created: attachment.created, source: {
    env: "EP0CH_WS", file: paths.configPath ?? ".ep0ch", pane: "the invoking pane's outline",
  }[paths.outlineSource ?? "env"] };
  if (attachment.created) {
    try {
      execFileSync(herdr, ["notification", "show", `Created outline ${name}`, "--body", `New outline "${name}" (named by ${attached.source}).`],
        { stdio: "ignore", timeout: HERDR_SYNC_TIMEOUT_MS });
    } catch {
      // The open itself reports the creation on stdout.
    }
  }

  const localHostname = hostname();
  function localHerdrClients(
    clients: OutlinerClientRegistration[],
  ): OutlinerClientRegistration[] {
    return clients.filter((client) => client.runtime?.hostname === localHostname);
  }

  function openPane(
    entrypoint: PaneEntrypoint,
    options: {
      placement: "split" | "tab";
      targetPane?: string;
      direction?: "right" | "down";
      env?: Record<string, string>;
    },
  ): string {
    const args = [
      "plugin",
      "pane",
      "open",
      "--plugin",
      pluginId,
      "--entrypoint",
      entrypoint,
      "--env",
      `OUTLINER_WORKSPACE_ROOT=${workspaceRoot}`,
      "--placement",
      options.placement,
      "--no-focus",
    ];
    for (const name of OUTLINE_ENV) {
      if (name !== "EP0CH_WS" && name !== "EP0CH_MACHINE" && process.env[name] !== undefined) args.push("--env", `${name}=${process.env[name]}`);
    }
    // Every pane lands on the same outline on the same machine, whatever its environment would resolve.
    args.push("--env", `EP0CH_WS=${name}`, "--env", `EP0CH_MACHINE=${paths.machine ?? ""}`);
    for (const [key, value] of Object.entries(options.env ?? {})) {
      args.push("--env", `${key}=${value}`);
    }
    if (options.direction) args.push("--direction", options.direction);
    if (options.targetPane) args.push("--target-pane", options.targetPane);
    const output = execFileSync(herdr, args, {
      encoding: "utf8",
      timeout: HERDR_SYNC_TIMEOUT_MS,
    });
    const paneId = (JSON.parse(output) as OpenPaneResponse).result?.plugin_pane?.pane?.pane_id;
    if (!paneId) throw new Error(`Herdr did not return a pane id for ${entrypoint}`);
    return paneId;
  }

  const remote = paths.mode === "remote";
  await waitForCompatibleService(createOutlinerClient(paths), {
    timeoutMs: mode === "find-detail" ? 3_000 : 60_000,
    pingTimeoutMs: remote ? undefined : 300,
  }).catch((error: unknown) => {
    const lastResponse = (error instanceof Error ? error.message : String(error)).replace(/\.$/, "");
    throw new Error(`Compatible outliner service did not become ready at ${paths.socket}. ${lastResponse}. ${remote
      ? remoteHint(paths)
      : `Check the outline host (it runs as a service) and the outline "${paths.outline}".`}`);
  });

  function invocationTarget(): {
    paneId?: string;
    tabId?: string;
    workspaceId?: string;
  } {
    return {
      ...(currentPaneId ? { paneId: currentPaneId } : {}),
      ...(invocationPane?.tab_id ? { tabId: invocationPane.tab_id } : {}),
      ...(invocationPane?.workspace_id ? { workspaceId: invocationPane.workspace_id } : {}),
    };
  }

  async function focusExisting(
    trees?: OutlinerClientRegistration[],
  ): Promise<{
        focusedClientId: string;
    workspaceRoot: string;
  }> {
    const liveTrees =
      trees ?? localHerdrClients(await listLiveClients(createOutlinerClient(paths), "tree"));
    const selected = selectTreeClientForInvocation(
      liveTrees,
      invocationTarget(),
      requestedClientId,
    );
    await sendClientCommand(createOutlinerClient(paths), selected.clientId, {
      command: "focus", targetRegion: "tree",
    });
    return { focusedClientId: selected.clientId, workspaceRoot };
  }

  async function waitForClientPane(
    paneId: string,
    role: "tree" | "detail" | "composed",
  ): Promise<OutlinerClientRegistration> {
    const client = createOutlinerClient(paths);
    const deadline = Date.now() + (paths.mode === "remote" ? 60_000 : 5_000);
    while (Date.now() < deadline) {
      try {
        const registration = localHerdrClients(await listLiveClients(client, role))
          .find((candidate) => candidate.runtime?.paneId === paneId);
        if (registration) return registration;
      } catch {
        // Retry until the pane has initialized and registered.
      }
      await sleep(100);
    }
    throw new Error(`Outliner ${role} did not become ready in pane ${paneId}`);
  }

  async function openTreeOnly() {
    if (!currentPaneId) throw new Error("open-tree requires Herdr invocation pane context");
    const browsingContextId = crypto.randomUUID();
    const outlinerPane = openPane("outliner", {
      placement: "split", targetPane: currentPaneId, direction: "right",
      env: { OUTLINER_BROWSING_CONTEXT_ID: browsingContextId },
    });
    await waitForClientPane(outlinerPane, "tree");
    execFileSync(herdr, ["plugin", "pane", "focus", outlinerPane], {stdio: "ignore", timeout: HERDR_SYNC_TIMEOUT_MS});
    return {outlinerPane, browsingContextId, workspaceRoot};
  }

  async function openHere(): Promise<{
        outlinerPane: string;
    detailPane: string;
    detailClientId: string;
    browsingContextId: string;
    workspaceRoot: string;
  }> {
    if (!currentPaneId) {
      throw new Error("open-here requires Herdr invocation pane context");
    }
    const browsingContextId = crypto.randomUUID();
    const outlinerPane = openPane("outliner", {
      placement: "split",
      targetPane: currentPaneId,
      direction: "right",
      env: { OUTLINER_BROWSING_CONTEXT_ID: browsingContextId },
    });
    const detailPane = openPane("detail", {
      placement: "split",
      targetPane: outlinerPane,
      direction: "down",
      env: { OUTLINER_BROWSING_CONTEXT_ID: browsingContextId },
    });
    if (focus) execFileSync(herdr, ["plugin", "pane", "focus", detailPane], {
      stdio: "ignore",
      timeout: HERDR_SYNC_TIMEOUT_MS,
    });
    const [treeView, detailView] = await Promise.all([
      waitForClientPane(outlinerPane, "tree"),
      waitForClientPane(detailPane, "detail"),
    ]);
    await createOutlinerClient(paths).request({action: "navigation.link.set", source: {clientId: treeView.clientId, region: "tree"}, destination: {clientId: detailView.clientId, region: "detail"}});
    if (focus) execFileSync(herdr, ["plugin", "pane", "focus", outlinerPane], {
      stdio: "ignore",
      timeout: HERDR_SYNC_TIMEOUT_MS,
    });
    return { outlinerPane, detailPane, detailClientId: detailView.clientId, browsingContextId, workspaceRoot };
  }

  async function openComposed() {
    if (!currentPaneId) throw new Error("open-composed requires Herdr invocation pane context");
    const browsingContextId = crypto.randomUUID();
    const pane = openPane("composed", {placement: "split", targetPane: currentPaneId, direction: "right", env: {OUTLINER_BROWSING_CONTEXT_ID: browsingContextId}});
    const view = await waitForClientPane(pane, "composed");
    await createOutlinerClient(paths).request({action: "navigation.link.set", source: {clientId: view.clientId, region: "tree"}, destination: {clientId: view.clientId, region: "detail"}});
    execFileSync(herdr, ["plugin", "pane", "focus", pane], {stdio: "ignore", timeout: HERDR_SYNC_TIMEOUT_MS});
    return {outlinerPane: pane, detailPane: pane, browsingContextId, workspaceRoot};
  }

  /**
   * The one Detail finder: the Tree for this invocation (its pane, else its tab, else its workspace) and the
   * Detail linked to it. Trees are looked for in the invoking pane's workspace only, so another workspace's
   * Detail is never "this tab's". `tree` is undefined when the workspace has none.
   */
  async function findDetail(): Promise<{
    clients: OutlinerClientRegistration[];
    tree?: OutlinerClientRegistration;
    detail?: OutlinerClientRegistration;
  }> {
    const clients = localHerdrClients(await listLiveClients(createOutlinerClient(paths)));
    const workspaceId = requestedClientId ? undefined : invocationPane?.workspace_id;
    // A Tree whose runtime sync hasn't said its workspace yet still counts.
    const trees = clients.filter((candidate) => clientSupportsRole(candidate, "tree") &&
      (!workspaceId || candidate.runtime?.workspaceId === undefined || candidate.runtime.workspaceId === workspaceId));
    if (trees.length === 0 && !requestedClientId) return { clients };
    const tree = selectTreeClientForInvocation(trees, invocationTarget(), requestedClientId);
    const link = await createOutlinerClient(paths).request<NavigationLinkState>({action: "navigation.link.get", source: {clientId: tree.clientId, region: "tree"}});
    const detail = selectLinkedDetailClient(clients, link.destination);
    return { clients, tree, ...(detail ? { detail } : {}) };
  }

  async function ensureDetail(): Promise<{
        treePane: string;
    detailPane: string;
    detailClientId: string;
    browsingContextId: string;
    opened: boolean;
    workspaceRoot: string;
  }> {
    const client = createOutlinerClient(paths);
    const { tree, detail: existing } = await findDetail();
    if (!tree) {
      const opened = await openHere();
      return {
        treePane: opened.outlinerPane,
        detailPane: opened.detailPane,
        detailClientId: opened.detailClientId,
        browsingContextId: opened.browsingContextId,
        opened: true,
        workspaceRoot,
      };
    }
    const treePane = tree.runtime?.paneId;
    if (!treePane) throw new Error("The selected Outliner Tree has no live Herdr pane");
    if (existing) {
      if (focus) await sendClientCommand(client, existing.clientId, { command: "focus", targetRegion: "detail" });
      const detailPane = existing.runtime?.paneId;
      if (!detailPane) throw new Error("The selected Outliner Detail has no live Herdr pane");
      return {
        treePane,
        detailPane,
        detailClientId: existing.clientId,
        browsingContextId: existing.contextId,
        opened: false,
        workspaceRoot,
      };
    }
    const detailPane = openPane("detail", {
      placement: "split",
      targetPane: treePane,
      direction: "down",
      env: { OUTLINER_BROWSING_CONTEXT_ID: tree.contextId },
    });
    if (focus) execFileSync(herdr, ["plugin", "pane", "focus", detailPane], {
      stdio: "ignore",
      timeout: HERDR_SYNC_TIMEOUT_MS,
    });
    const detailView = await waitForClientPane(detailPane, "detail");
    await client.request({action: "navigation.link.set", source: {clientId: tree.clientId, region: "tree"}, destination: {clientId: detailView.clientId, region: "detail"}});
    return {
      treePane,
      detailPane,
      detailClientId: detailView.clientId,
      browsingContextId: tree.contextId,
      opened: true,
      workspaceRoot,
    };
  }

  /**
   * What ensure-detail would reuse, opening and focusing nothing: the Detail's client and pane, or null. A
   * selection ensure-detail would refuse (two Trees in the tab, a dead link) is null with its reason, not a failure:
   * a caller asking in the background (the Claude mod's heading) never raises a Herdr notification for it.
   */
  async function reportDetail(): Promise<{ detailClientId: string | null; detailPane: string | null; treePane: string | null; why?: string; workspaceRoot: string }> {
    try {
      const { tree, detail } = await findDetail();
      return {
        detailClientId: detail?.clientId ?? null,
        detailPane: detail?.runtime?.paneId ?? null,
        treePane: tree?.runtime?.paneId ?? null,
        workspaceRoot,
      };
    } catch (error) {
      return { detailClientId: null, detailPane: null, treePane: null, why: error instanceof Error ? error.message : String(error), workspaceRoot };
    }
  }
  let result: object;
  if (mode === "service-only") {
    result = { workspaceRoot };
  } else if (mode === "open-composed") {
    result = await openComposed();
  } else if (mode === "open-tree") {
    result = await openTreeOnly();
  } else if (mode === "open-here") {
    result = await openHere();
  } else if (mode === "ensure-detail") {
    result = await ensureDetail();
  } else if (mode === "find-detail") {
    result = await reportDetail();
  } else if (mode === "focus-existing") {
    result = await focusExisting();
  } else {
    const trees = localHerdrClients(
      await listLiveClients(createOutlinerClient(paths), "tree"),
    );
    result = trees.length === 0 && !requestedClientId
      ? await openHere()
      : await focusExisting(trees);
  }
  process.stdout.write(`${JSON.stringify({ ...result, outline: attached.name, outlineCreated: attached.created })}\n`);
}, { callerReports });
