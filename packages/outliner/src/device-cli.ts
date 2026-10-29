// `device add <name>`, `device ls` and `device revoke <name|id>` (`ep0ch device …`, PIE-1267): the phones and other
// devices that may send a file to the artifacts inbox with a token of their own (upload-tokens.ts), asked of this
// machine's outline host. The token opens the upload route and nothing else; revoking one ends it from the next request.
import { ageSince } from "@ep0ch/outline-core/age";
import type { UploadDevice } from "@ep0ch/outline-core/protocol";
import { outlineHostClient } from "./outline-host-client";
import { resolveClientPaths } from "./paths";
import { plistXml, sendToEp0chWorkflow, shortcutSigner, signShortcut } from "./send-to-ep0ch-shortcut";

export const DEVICE_USAGE = `device add <name> [--ws <outline>] [--json]   set up a device that can send files here; prints its link once
  device add <name> --shortcut [--ws <outline>]  the same, as a signed "Send to ep0ch" Shortcut: prints the sign-in page
                                              the phone opens to add it (signed on a Mac: EP0CH_SHORTCUT_SIGNER, else laptop)
  device ls [--json]                          the devices, when each last sent something, and which are revoked
  device revoke <name|id> [--json]            end a device's link now (a lost phone)`;

const ago = (iso: string | undefined, now: number) => (iso ? ageSince(iso, now, "ago") : "never");

export const deviceLine = (device: UploadDevice, now = Date.now()) =>
  `${device.id}  ${device.name}  (cards go to ${device.outline})\n    ${device.revokedAt ? `revoked ${ago(device.revokedAt, now)}` : `last sent ${ago(device.lastUsedAt, now)}`} · made ${device.createdAt.slice(0, 10)}${device.shortcutUrl ? `\n    its Shortcut: ${device.shortcutUrl}` : ""}`;

export async function runDeviceCommand(args: string[], io = { out: console.log, err: console.error }, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const json = args.includes("--json"), wantsShortcut = args.includes("--shortcut");
  const rest = args.filter(word => word !== "--json" && word !== "--shortcut");
  const at = rest.indexOf("--ws");
  const ws = at >= 0 ? rest[at + 1] : undefined;
  if (at >= 0 && (!ws || ws.startsWith("--"))) { io.err(`error: --ws needs an outline's name (ep0ch outline list)`); return 2; }
  const words = at >= 0 ? [...rest.slice(0, at), ...rest.slice(at + 2)] : rest;
  const [verb, ...names] = words;
  if (verb !== "add" && verb !== "ls" && verb !== "revoke") { io.err(`error: device takes add, ls or revoke\n  ${DEVICE_USAGE}`); return 2; }
  if (wantsShortcut && verb !== "add") { io.err(`error: --shortcut goes with device add (a device's token is shown only when it is made)\n  ${DEVICE_USAGE}`); return 2; }
  if (verb === "ls" ? names.length > 0 : names.length !== 1) { io.err(`error: device ${verb} ${verb === "ls" ? "takes no words" : "takes one name"}${names.length ? ` (${names.join(" ")})` : ""}\n  ${DEVICE_USAGE}`); return 2; }
  const host = await outlineHostClient(env);
  if (!host) { io.err("error: no outline host answers on this machine: start it (systemctl --user start outliner-host), or run this on the machine that publishes (ssh float-2 ep0ch device …)"); return 1; }
  try {
    if (verb === "ls") {
      const { devices } = await host.request<{ devices: UploadDevice[] }>({ action: "devices.list" });
      if (json) io.out(JSON.stringify({ devices }, null, 2));
      else io.out(devices.length ? devices.map(device => deviceLine(device)).join("\n") : "no device is set up: ep0ch device add \"Evan's iPhone\"");
      return 0;
    }
    if (verb === "revoke") {
      const { revoked } = await host.request<{ revoked: UploadDevice[] }>({ action: "devices.revoke", device: names[0]! });
      if (json) io.out(JSON.stringify({ revoked }, null, 2));
      else io.out(`revoked: ${revoked.map(device => `${device.name} (${device.id})`).join(", ")}; its link opens nothing now`);
      return 0;
    }
    const outline = ws ?? resolveClientPaths(env).outline;
    if (!outline) { io.err(`error: say which outline gets the cards: ep0ch device add ${JSON.stringify(names[0])} --ws <outline> (ep0ch outline list)`); return 2; }
    const added = await host.request<{ device: UploadDevice; token: string; url: string }>({ action: "devices.add", name: names[0]!, outline });
    if (wantsShortcut) {
      let device: UploadDevice;
      try {
        const signed = await signShortcut(plistXml(sendToEp0chWorkflow(added.url)), shortcutSigner(env), env);
        ({ device } = await host.request<{ device: UploadDevice }>({ action: "devices.shortcut.put", device: added.device.id, data: Buffer.from(signed).toString("base64") }));
      } catch (error) {
        // Nobody holds this token now: end it, so the same name can be tried again.
        await host.request({ action: "devices.revoke", device: added.device.id }).catch(() => {});
        throw new Error(`${error instanceof Error ? error.message : String(error)}. The new device was revoked (device ls lists it as revoked); try again: ep0ch device add ${JSON.stringify(added.device.name)} --ws ${outline} --shortcut`);
      }
      if (json) io.out(JSON.stringify({ device }, null, 2));
      else io.out(`${device.name} can send files; cards go to ${outline}'s note for today.\nOpen this on the phone, signed in, and tap Add Shortcut. Then share any file or photo to "Send to ep0ch".\n\n${device.shortcutUrl}\n\nLost the phone? ep0ch device revoke ${JSON.stringify(device.name)}`);
      return 0;
    }
    if (json) io.out(JSON.stringify(added, null, 2));
    else io.out(`${added.device.name} can send files; cards go to ${outline}'s note for today.\nThis link is its token, shown once: keep it in the Shortcut (the Artifacts hub's "Send to ep0ch" recipe), not in a chat.\n\n${added.url}\n\nLost the phone? ep0ch device revoke ${JSON.stringify(added.device.name)}`);
    return 0;
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
