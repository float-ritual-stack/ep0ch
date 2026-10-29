// The "Send to ep0ch" Apple Shortcut, built and signed for one device (PIE-1408): `ep0ch device add <name> --shortcut`
// makes the device's upload link (upload-tokens.ts), writes the Shortcut around it, signs it on a Mac
// (`shortcuts sign --mode anyone`, over ssh from a machine without one) and keeps the signed file in the host's folder,
// served behind the sign-in at /_shortcut/<device id>/ (web-signin.ts). The phone opens that one link and taps Add
// Shortcut: nothing to edit, no link to copy.
//
// What it does, per shared file: Text "<Name>.<File Extension>", URL Encode it, Get Contents of URL
// (POST <link>/<encoded name>?reply=text, the file as the body), Show Notification with the answer. No questions:
// the card goes to the device's outline's note for today. The action identifiers and parameter keys follow what the
// Shortcuts app writes (cross-checked against cherri's action table, github.com/electrikmilk/cherri).
import { randomUUID } from "node:crypto";

/** The name the phone shows; the file is served as `<this>.shortcut`, and Shortcuts names the import after it. */
export const SHORTCUT_NAME = "Send to ep0ch";
/** How the signed file is served: one place, so a real phone's preference is a one-line change. */
export const SHORTCUT_HEADERS = {
  "content-type": "application/octet-stream",
  "content-disposition": `attachment; filename="${SHORTCUT_NAME}.shortcut"`,
  "cache-control": "no-store",
};

type Plist = string | number | boolean | Plist[] | { [key: string]: Plist };

const OBJECT = "￼";
interface Ref { Type: string; VariableName?: string; OutputUUID?: string; OutputName?: string; Aggrandizements?: Plist[] }
const repeatItem = (property?: string): Ref => ({
  Type: "Variable", VariableName: "Repeat Item",
  ...(property ? { Aggrandizements: [{ Type: "WFPropertyVariableAggrandizement", PropertyName: property, PropertyUserInfo: 0 }] } : {}),
});
const output = (uuid: string, name: string): Ref => ({ Type: "ActionOutput", OutputUUID: uuid, OutputName: name });
const attachment = (ref: Ref) => ({ Value: ref as unknown as Plist, WFSerializationType: "WFTextTokenAttachment" });
/** Text with variables in it: each `￼` in `parts` joined is the next ref, keyed by its UTF-16 offset. */
function tokens(parts: string[], refs: Ref[]) {
  const string = parts.join(OBJECT);
  const attachmentsByRange: Record<string, Plist> = {};
  let at = 0;
  refs.forEach((ref, index) => { at += parts[index]!.length; attachmentsByRange[`{${at}, 1}`] = ref as unknown as Plist; at += 1; });
  return { Value: { string, attachmentsByRange }, WFSerializationType: "WFTextTokenString" };
}
const action = (id: string, parameters: Record<string, Plist>) => ({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: parameters });

/** The Shortcut's workflow for the device link `uploadUrl` (`https://…/_upload/<token>`), as a plist's root dictionary. */
export function sendToEp0chWorkflow(uploadUrl: string, ids: () => string = () => randomUUID().toUpperCase()): Record<string, Plist> {
  const link = uploadUrl.replace(/\/+$/, "");
  const group = ids(), name = ids(), encoded = ids(), sent = ids(), end = ids();
  return {
    WFWorkflowActions: [
      action("repeat.each", { WFControlFlowMode: 0, GroupingIdentifier: group, WFInput: attachment({ Type: "ExtensionInput" }) }),
      action("gettext", { UUID: name, WFTextActionText: tokens(["", ".", ""], [repeatItem("Name"), repeatItem("File Extension")]) }),
      action("urlencode", { UUID: encoded, WFEncodeMode: "Encode", WFInput: tokens(["", ""], [output(name, "Text")]) }),
      action("downloadurl", {
        UUID: sent, WFURL: tokens([`${link}/`, "?reply=text"], [output(encoded, "URL Encoded Text")]),
        Advanced: true, ShowHeaders: false, WFHTTPMethod: "POST", WFHTTPBodyType: "File", WFRequestVariable: attachment(repeatItem()),
      }),
      action("notification", { WFNotificationActionTitle: SHORTCUT_NAME, WFNotificationActionBody: tokens(["", ""], [output(sent, "Contents of URL")]), WFNotificationActionSound: true }),
      action("repeat.each", { WFControlFlowMode: 2, GroupingIdentifier: group, UUID: end }),
    ],
    WFWorkflowClientVersion: "4033.0.4.3",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    // A paper plane on dark blue.
    WFWorkflowIcon: { WFWorkflowIconGlyphNumber: 0xe9bc, WFWorkflowIconStartColor: 0x3871deff },
    WFWorkflowImportQuestions: [],
    WFWorkflowInputContentItemClasses: ["WFAVAssetContentItem", "WFGenericFileContentItem", "WFImageContentItem", "WFPDFContentItem"],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowTypes: ["ActionExtension"],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowHasOutputFallback: false,
  };
}

const xml = (value: string) => value.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
function plistValue(value: Plist, indent: string): string {
  if (typeof value === "string") return `${indent}<string>${xml(value)}</string>`;
  if (typeof value === "boolean") return `${indent}<${value}/>`;
  if (typeof value === "number") return `${indent}<integer>${Math.trunc(value)}</integer>`;
  const inner = `${indent}\t`;
  if (Array.isArray(value)) return value.length ? `${indent}<array>\n${value.map(item => plistValue(item, inner)).join("\n")}\n${indent}</array>` : `${indent}<array/>`;
  const entries = Object.entries(value);
  return entries.length ? `${indent}<dict>\n${entries.map(([key, item]) => `${inner}<key>${xml(key)}</key>\n${plistValue(item, inner)}`).join("\n")}\n${indent}</dict>` : `${indent}<dict/>`;
}

/** An XML property list, as `shortcuts sign` reads it. */
export function plistXml(root: Record<string, Plist>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(root, "")}\n</plist>\n`;
}

/** Where the Shortcut is signed: `EP0CH_SHORTCUT_SIGNER` (an ssh name, or `local` on a Mac), else here on a Mac, else `laptop`. */
export const shortcutSigner = (env: NodeJS.ProcessEnv = process.env) => env.EP0CH_SHORTCUT_SIGNER?.trim() || (process.platform === "darwin" ? "local" : "laptop");

/**
 * Signs `plist` for anyone to import, on a Mac: here (`local`), or on the ssh name `signer` in a temporary folder that
 * is removed afterwards. Returns the signed file (Apple Encrypted Archive, `AEA1`), or throws why not.
 */
export async function signShortcut(plist: string, signer: string, env: NodeJS.ProcessEnv = process.env): Promise<Uint8Array> {
  const script = `d=$(mktemp -d) || exit 1; cat > "$d/in.shortcut" && shortcuts sign --mode anyone --input "$d/in.shortcut" --output "$d/out.shortcut" >&2 && cat "$d/out.shortcut"; s=$?; rm -rf "$d"; exit $s`;
  const command = signer === "local" ? ["/bin/sh", "-c", script] : [env.EP0CH_SSH?.trim() || "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", signer, script];
  const run = Bun.spawn(command, { stdin: new TextEncoder().encode(plist), stdout: "pipe", stderr: "pipe", env, timeout: 120_000 });
  const [signed, said, code] = await Promise.all([new Response(run.stdout).bytes(), new Response(run.stderr).text(), run.exited]);
  const where = signer === "local" ? "here" : `on ${signer}`;
  if (code !== 0) throw new Error(`signing the Shortcut ${where} failed (exit ${code})${said.trim() ? `: ${said.trim().split("\n").slice(-2).join(" ")}` : ""}. It needs a Mac with /usr/bin/shortcuts, reached by ssh (EP0CH_SHORTCUT_SIGNER names it)`);
  if (Buffer.from(signed.subarray(0, 4)).toString("latin1") !== "AEA1") throw new Error(`signing the Shortcut ${where} gave back something that isn't a signed Shortcut (${signed.length} bytes)`);
  return signed;
}

/** The answer to `/_shortcut/<device id>/…` once signed in: the signed file, or why there is none. */
export async function shortcutResponse(host: { request<T>(input: Record<string, unknown> & { action: string }): Promise<T> }, deviceId: string): Promise<Response> {
  const { data } = await host.request<{ data: string | null }>({ action: "devices.shortcut.get", device: deviceId });
  if (!data) return new Response(`No Shortcut is waiting here: the device was revoked or never had one. On the server: ep0ch device add "<name>" --shortcut\n`, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(Buffer.from(data, "base64"), { status: 200, headers: SHORTCUT_HEADERS });
}
