// Upload tokens (PIE-1267): what lets a file reach the artifacts inbox from outside. Two kinds, one route
// (`/_upload/<token>`, publish-upload.ts):
//   - a LEASE: one name, one upload, one hour. Minted for an agent that curls a file (`artifact_upload_lease`,
//     `ep0ch artifact lease <name>`), like the Loki query lease (loki-leases.ts) it is a bearer secret in a URL.
//   - a DEVICE token: made by `ep0ch device add <name>`, kept until revoked, so a phone's Shortcut can send many.
//     It opens this route and nothing else.
// Host-owned like web sessions, in one 0600 file in the host's folder: a deploy between minting and curling doesn't
// end a lease. The file keeps SHA-256 digests only; nothing logs a token. Like a snapshot link (PIE-940), only a
// FINISHED upload uses a lease up: a HEAD, a preview or an interrupted transfer leaves it working until it expires.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { UploadDevice, UploadTake } from "@ep0ch/outline-core/protocol";

/** One hour, fixed: a leaked link adds at most one artifact, for at most this long. */
export const UPLOAD_LEASE_TTL_MS = 60 * 60_000;
/** Active leases at once: more is a loop, not a person asking. */
const MAX_ACTIVE_LEASES = 50;
/** An ended lease answers 410 (not 404) for this long. */
const ENDED_KEPT_MS = 24 * 60 * 60_000;
const MAX_DEVICES = 20;

interface StoredLease { id: string; digest: string; name?: string; outline: string; by: string; createdAt: string; expiresAt: string; usedAt?: string }
interface StoredDevice extends UploadDevice { digest: string }
interface File { leases: StoredLease[]; devices: StoredDevice[] }

const digestOf = (token: string) => createHash("sha256").update(token).digest("hex");
const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const newToken = () => randomBytes(32).toString("base64url");

export class UploadTokens {
  /** Uploads under way (a PUT that has begun and not finished), by claim. Memory only: a restart ends the transfer too. */
  private readonly claims = new Map<string, { id: string; kind: "lease" | "device" }>();
  constructor(private readonly file: string, private readonly log: (message: string) => void = () => {}, private readonly now: () => number = Date.now) {}

  private load(): File {
    let raw: string;
    try { raw = readFileSync(this.file, "utf8"); } catch { return { leases: [], devices: [] }; }
    try {
      const parsed = JSON.parse(raw) as Partial<File>;
      const now = this.now();
      return {
        leases: (Array.isArray(parsed.leases) ? parsed.leases : []).filter(l => l && typeof l.digest === "string" && now - Date.parse(l.expiresAt) < ENDED_KEPT_MS),
        devices: (Array.isArray(parsed.devices) ? parsed.devices : []).filter(d => d && typeof d.digest === "string"),
      };
    } catch { return { leases: [], devices: [] }; }
  }

  private save(data: File): void {
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 1)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.file);
  }

  /** A lease for one upload named `name`; its token is said here once. */
  startLease(input: { name?: string; outline: string; by: string }): { id: string; token: string; expiresAt: string } {
    const data = this.load(), now = this.now();
    if (data.leases.filter(l => !l.usedAt && Date.parse(l.expiresAt) > now).length >= MAX_ACTIVE_LEASES) {
      throw new Error(`${MAX_ACTIVE_LEASES} upload leases are open already: use or wait out some first`);
    }
    const token = newToken(), id = randomBytes(4).toString("hex"), expiresAt = new Date(now + UPLOAD_LEASE_TTL_MS).toISOString();
    data.leases.push({ id, digest: digestOf(token), ...(input.name ? { name: input.name } : {}), outline: input.outline, by: clean(input.by, 120) || "local", createdAt: new Date(now).toISOString(), expiresAt });
    this.save(data);
    this.log(JSON.stringify({ event: "upload.lease.start", id, ...(input.name ? { name: input.name } : {}), outline: input.outline, by: input.by, expiresAt }));
    return { id, token, expiresAt };
  }

  /**
   * Whether `token` admits a request with this method. GET and HEAD only look (the drop page, a link preview): they
   * claim nothing and burn nothing. A write claims the upload (a lease admits one at a time); `finish` settles it.
   */
  take(token: string, method: "GET" | "HEAD" | "PUT" | "POST"): UploadTake {
    const digest = digestOf(token), data = this.load(), now = this.now();
    const writing = method === "PUT" || method === "POST";
    const lease = data.leases.find(l => l.digest === digest);
    if (lease) {
      const answer = (status: 404 | 409 | 410, reason: string): UploadTake => {
        this.log(JSON.stringify({ event: "upload.use", lease: lease.id, method, status }));
        return { status, reason };
      };
      if (lease.usedAt) return answer(410, "This upload link was already used. Ask for a new one: artifact_upload_lease, or ep0ch artifact lease <name>.");
      if (Date.parse(lease.expiresAt) <= now) return answer(410, "This upload link expired (a lease lasts one hour). Ask for a new one: artifact_upload_lease, or ep0ch artifact lease <name>.");
      if (writing && [...this.claims.values()].some(c => c.id === lease.id)) return answer(409, "An upload on this link is still arriving; wait for it to finish, then try again if it fails.");
      const claim = writing ? randomUUID() : undefined;
      if (claim) this.claims.set(claim, { id: lease.id, kind: "lease" });
      this.log(JSON.stringify({ event: "upload.use", lease: lease.id, method, status: 200 }));
      return { status: 200, ...(claim ? { claim } : {}), who: { kind: "lease", id: lease.id, ...(lease.name ? { name: lease.name } : {}), outline: lease.outline, by: lease.by }, expiresAt: lease.expiresAt };
    }
    const device = data.devices.find(d => d.digest === digest);
    if (device) {
      if (device.revokedAt) {
        this.log(JSON.stringify({ event: "upload.use", device: device.id, method, status: 410 }));
        return { status: 410, reason: `This device token was revoked (${device.name}). Make a new one: ep0ch device add <name>.` };
      }
      const claim = writing ? randomUUID() : undefined;
      if (claim) this.claims.set(claim, { id: device.id, kind: "device" });
      this.log(JSON.stringify({ event: "upload.use", device: device.id, method, status: 200 }));
      return { status: 200, ...(claim ? { claim } : {}), who: { kind: "device", id: device.id, outline: device.outline, by: device.name, deviceName: device.name } };
    }
    this.log(JSON.stringify({ event: "upload.use", method, status: 404 }));
    return { status: 404, reason: "No upload link here. It may have expired, been revoked, or the host restarted without it: ask for a new one (artifact_upload_lease, or ep0ch artifact lease <name>)." };
  }

  /** An upload ended: `ok` settles it (a lease is used up, a device's last use is noted); otherwise the lease stays good. */
  finish(claim: string, ok: boolean): void {
    const held = this.claims.get(claim);
    this.claims.delete(claim);
    if (!held || !ok) return;
    const data = this.load(), at = new Date(this.now()).toISOString();
    if (held.kind === "lease") { const lease = data.leases.find(l => l.id === held.id); if (lease) lease.usedAt = at; }
    else { const device = data.devices.find(d => d.id === held.id); if (device) device.lastUsedAt = at; }
    this.save(data);
  }

  addDevice(input: { name: string; outline: string }): { device: UploadDevice; token: string } {
    const name = clean(input.name, 40);
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name)) throw new Error("A device name is letters, numbers, spaces, dots, hyphens or underscores, e.g. ep0ch device add \"Evan's iPhone\"");
    const data = this.load();
    if (data.devices.some(d => !d.revokedAt && d.name.toLowerCase() === name.toLowerCase())) throw new Error(`A device named ${name} is already set up: ep0ch device revoke "${name}" first, or pick another name`);
    if (data.devices.filter(d => !d.revokedAt).length >= MAX_DEVICES) throw new Error(`${MAX_DEVICES} devices are set up already: ep0ch device ls, then revoke the ones you don't use`);
    const token = newToken();
    const stored: StoredDevice = { id: randomBytes(4).toString("hex"), name, outline: input.outline, createdAt: new Date(this.now()).toISOString(), digest: digestOf(token) };
    data.devices.push(stored);
    this.save(data);
    this.log(JSON.stringify({ event: "upload.device.add", id: stored.id, name, outline: input.outline }));
    return { device: this.shown(stored), token };
  }

  devices(): UploadDevice[] { return this.load().devices.map(d => this.shown(d)); }

  /** Ends the device named (or with the id) `ref`; its token opens nothing from the next request. */
  revokeDevice(ref: string): UploadDevice[] {
    const data = this.load(), at = new Date(this.now()).toISOString();
    const match = data.devices.filter(d => !d.revokedAt && (d.id === ref || d.name.toLowerCase() === ref.toLowerCase()));
    if (!match.length) throw new Error(`No device ${ref} is set up: ep0ch device ls`);
    for (const device of match) device.revokedAt = at;
    this.save(data);
    this.log(JSON.stringify({ event: "upload.device.revoke", ids: match.map(d => d.id) }));
    return match.map(d => this.shown(d));
  }

  private shown({ digest: _digest, ...device }: StoredDevice): UploadDevice { return device; }
}
