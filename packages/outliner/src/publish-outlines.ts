// The web client over every outline the host serves: the home outline at the web root (`/pub`), as always, and each
// other outline at `/pub/o/<name>/`, its own Publisher (the same class, the same pages and routes) started the first
// time it is asked for and kept. `/pub/o/` lists them. The tailnet listener and the sign-in listener (web-signin.ts) both
// answer through this, so a signed-in browser reads exactly what the tailnet does. Public snapshot tokens also
// reach their named outline here, without granting page reads. Another machine's outline is at
// `/pub/o/<name>@<machine>/`, read live through that machine's forward or from its copy here (publish-remote.ts).
import { isOutlineName } from "./paths";
import { darkError, escapeHtml, plainPage, type Publisher, type PublishAudience, type SignedIn } from "./publish";
import type { RemoteOutline } from "./publish-remote";

export interface OutlinePublishersOptions {
  /** The home outline's publisher, mounted at the web root. */
  home: Publisher;
  /** Its outline's name (`pie`): `/pub/o/<home>/` goes back to the root. */
  homeName?: string;
  /** The outlines the host serves now (`outlines.list`). */
  names: () => Promise<string[]>;
  /** A publisher for another outline, mounted at `<webRoot>/o/<name>`; started here. */
  open: (name: string, basePath: string) => Publisher;
  /** Other machines' outlines (`EP0CH_MCP_MIRRORS`), each at `<webRoot>/o/<name>@<machine>`. */
  remotes?: readonly RemoteOutline[];
  log?: (line: string) => void;
}

const OUTLINE_PATH = /^\/o\/([^/]+)(\/.*)?$/;

export class OutlinePublishers {
  private readonly others = new Map<string, Promise<Publisher>>();
  private readonly log: (line: string) => void;

  constructor(private readonly options: OutlinePublishersOptions) {
    this.log = options.log ?? (() => {});
  }

  get webRoot(): string {
    return this.options.home.webRoot;
  }

  /** One request: an outline's own publisher below `/o/<name>`, the outlines' list at `/o/`, else the home outline; an error a browser opens is a dark page. */
  async handle(request: Request, audience: PublishAudience = "tailnet", signedIn?: SignedIn): Promise<Response> {
    return darkError(request, await this.route(request, audience, signedIn));
  }

  private async route(request: Request, audience: PublishAudience, signedIn?: SignedIn): Promise<Response> {
    if (audience === "public") {
      if (!this.options.home.hostAllowed(request.headers.get("host") ?? new URL(request.url).host, audience)) {
        return new Response("Host not allowed\n", { status: 421 });
      }
      const path = new URL(request.url).pathname;
      const mount = this.options.home.publicBase.basePath;
      const below = mount && path.startsWith(`${mount}/`) ? path.slice(mount.length) : path;
      if (/^\/o\/[^/]+\/s\/[^/]+\/snapshot\.sqlite$/.test(below)) return this.snapshot(request, mount);
      return this.options.home.handle(request, audience, undefined, signedIn);
    }
    // The tailnet's Host rule, before anything is listed (the sign-in listener checked its own name).
    if (!signedIn && !this.options.home.hostAllowed(request.headers.get("host") ?? new URL(request.url).host, audience)) {
      return new Response("Host not allowed\n", { status: 421, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const root = this.webRoot;
    const pathname = new URL(request.url).pathname;
    // A proxy that mounts the web root and strips it (`tailscale serve` /pub) sends `/o/…`; the publisher takes both
    // forms for its own pages, so the outlines do too.
    const below = root && (pathname === root || pathname.startsWith(`${root}/`)) ? pathname.slice(root.length) : pathname;
    if (below === "/o" || below === "/o/") return this.list(request);
    // Another machine's snapshot link is its copy's here, whether or not the machine answers now (PIE-1091).
    if (this.options.remotes?.length && /^\/o\/[^/]+\/s\/[^/]+\/snapshot\.sqlite$/.test(below)) return this.snapshot(request, root);
    const named = below === null ? null : OUTLINE_PATH.exec(below);
    if (!named) return this.options.home.handle(request, audience, undefined, signedIn);
    let name: string;
    try { name = decodeURIComponent(named[1]!); } catch { name = ""; }
    if (name === this.options.homeName) return redirect(`${root}${named[2] ?? "/"}`);
    const remote = this.options.remotes?.find((candidate) => candidate.address === name);
    if (!remote && (!isOutlineName(name) || !(await this.options.names()).includes(name))) return plainPage("No such outline", `<h1>No outline “${escapeHtml(name)}” here</h1>\n<p><a href="${escapeHtml(`${root}/o/`)}">the outlines</a></p>\n`, 404);
    let publisher: Publisher;
    try {
      if (remote) {
        const served = await remote.publisher();
        if ("error" in served) throw new Error(served.error);
        publisher = served;
      } else publisher = await this.publisher(name);
    } catch (error) {
      this.log(`publish: outline ${name}: ${error instanceof Error ? error.message : String(error)}`);
      return plainPage("Not reachable", `<h1>${escapeHtml(name)} can't be read now</h1>\n<p class="dim">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>\n`, 502);
    }
    // Another machine's outline is handed its own path as its links say it (`@` as is, however the browser sent it).
    if (remote) {
      const url = new URL(request.url);
      url.pathname = `${publisher.basePath}${named[2] ?? "/"}`;
      return publisher.handle(new Request(url, request), audience, undefined, signedIn);
    }
    if (pathname.startsWith(`${root}/`)) return publisher.handle(request, audience, undefined, signedIn);
    // Stripped by a proxy: hand the outline's publisher its own path below `/o/<name>`, which it takes as it takes
    // `/p/…` for the home outline.
    const url = new URL(request.url);
    url.pathname = named[2] ?? "/";
    return publisher.handle(new Request(url, request), audience, undefined, signedIn);
  }

  /** Write leases reach the publisher that minted them, without opening an outline or granting reads. */
  async readerWrite(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const below = path.startsWith(`${this.webRoot}/`) ? path.slice(this.webRoot.length) : "";
    const match = /^(?:\/o\/([^/]+))?\/_reader\/([A-Za-z0-9_-]+)$/.exec(below);
    if (!match) return new Response("Not found", { status: 404 });
    const publisher = match[1] ? await this.others.get(match[1]) : this.options.home;
    if (!publisher) return new Response("Lease ended", { status: 410 });
    return publisher.readerWrite(request, match[2]!);
  }

  /** Only a snapshot token grants this route; it never opens pages or the outline index. */
  async snapshot(request: Request, root = this.webRoot): Promise<Response> {
    const path = new URL(request.url).pathname;
    const below = root && path.startsWith(`${root}/`) ? path.slice(root.length) : path;
    const match = /^(?:\/o\/([^/]+))?\/s\/([A-Za-z0-9_-]+)\/snapshot\.sqlite$/.exec(below);
    let name: string | undefined;
    try { name = match?.[1] ? decodeURIComponent(match[1]) : this.options.homeName; }
    catch { return new Response("Not found", { status: 404 }); }
    // Another machine's outline: its copy here minted the link (the gateway's outline_snapshot), never its own host.
    const remote = this.options.remotes?.find((candidate) => candidate.address === name);
    if (match && remote) {
      const copy = await remote.copyPublisher();
      return "error" in copy ? new Response("Not found", { status: 404 }) : copy.snapshotDownload(request, match[2]!);
    }
    if (!match || !name || !isOutlineName(name) || !(await this.options.names()).includes(name)) return new Response("Not found", { status: 404 });
    const publisher = name === this.options.homeName ? this.options.home : await this.publisher(name);
    return publisher.snapshotDownload(request, match[2]!);
  }

  private publisher(name: string): Promise<Publisher> {
    let pending = this.others.get(name);
    if (!pending) {
      const publisher = this.options.open(name, `${this.webRoot}/o/${name}`);
      pending = publisher.start().then(() => publisher);
      // A start that failed is tried again next time.
      pending.catch(() => { if (this.others.get(name) === pending) this.others.delete(name); void publisher.stop(); });
      this.others.set(name, pending);
    }
    return pending;
  }

  private async list(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Read-only\n", { status: 405, headers: { allow: "GET, HEAD" } });
    const root = this.webRoot;
    const names = await this.options.names();
    const rows = names.map((name) => {
      const href = name === this.options.homeName ? `${root}/` : `${root}/o/${encodeURIComponent(name)}/`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(name)}</a>${name === this.options.homeName ? ` <span class="dim">(home)</span>` : ""}</li>`;
    }).join("\n");
    const remotes = this.options.remotes ?? [];
    const away = remotes.map((remote) => {
      const said = remote.state === "live" ? "live" : remote.state === "copy" ? `${remote.machine} asleep: its copy here` : "";
      return `<li><a href="${escapeHtml(`${root}/o/${remote.address}/`)}">${escapeHtml(remote.address)}</a>${said ? ` <span class="dim">(${escapeHtml(said)})</span>` : ""}</li>`;
    }).join("\n");
    const others = away ? `<h2>On other machines</h2>\n<p class="dim">Read live through the machine's ssh forward, or from its copy here while it's asleep.</p>\n<ul class="kids">\n${away}\n</ul>\n` : "";
    return plainPage("Outlines", `<h1>Outlines</h1>\n<p class="dim">Every outline this machine's host serves.</p>\n<ul class="kids">\n${rows}\n</ul>\n${others}`);
  }

  async stop(): Promise<void> {
    const started = await Promise.allSettled(this.others.values());
    this.others.clear();
    for (const result of started) if (result.status === "fulfilled") await result.value.stop();
    await Promise.all((this.options.remotes ?? []).map((remote) => remote.stop()));
  }
}

const redirect = (location: string) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
