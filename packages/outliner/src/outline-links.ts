import { join } from "node:path";
import { OutlineMirror, mirrorsConfig } from "./outline-mirror";
import { SCHEMA_VERSION } from "./schema";
import type { AwayMachine } from "@ep0ch/outline-core/outline-away";
import { existsSync, readdirSync } from "node:fs";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { OutlinerClient } from "./client";
import { resolveBlockReferencesWithStatus } from "./references";
import type { Block, HostedOutlineList } from "./types";
import { readAuthoredLinks } from "./authored-links";
import { blockReferenceOccurrences, embeddedPageAddress, pageAddressReferences, normalizePageAddress, qualifiedReference } from "@ep0ch/outline-core/link-syntax";
import { readTransclusionsAsync } from "./transclusions";
import { blockReferenceDisplayText } from "./references";
import type { OutlinerStore } from "./store";
import type { BlockReferenceResolution, OutlinerRequest } from "./types";

/** How often a machine that didn't answer is asked again (in the background), and how long it has to answer. */
const SILENT_FOR_MS = 30_000;
const PROBE_MS = 5_000;
const FAIR_CHANCE_MS = 1_000;

/** The host supplies stores; the per-outline server never opens another outline itself. */
export class OutlineLinks {
  constructor(private names: () => string[], private open: (name: string) => Promise<OutlinerStore>, private folder: string) {}

  private mirrors = new Map<string, OutlineMirror<OutlinerClient>>();
  /**
   * Machines whose host didn't answer, read from their copies until it does (PIE-1546): a sleeping laptop's link
   * accepts and never answers, and every link read waited out the whole deadline for it. Each is asked again in the
   * background (`probe`) at most every SILENT_FOR_MS, and read live again once it answers.
   */
  private silent = new Map<string, { next: number; asking?: true }>();

  private probe(machine: string, socket: string): void {
    const silent = this.silent.get(machine);
    if (!silent || silent.asking || silent.next > Date.now()) return;
    silent.asking = true;
    new OutlinerClient(socket, PROBE_MS).request<HostedOutlineList>({ action: "outlines.list" })
      .then(() => { this.silent.delete(machine); }, () => { this.silent.set(machine, { next: Date.now() + SILENT_FOR_MS }); });
  }

  async close() { await Promise.all([...this.mirrors.values()].map(m => m.close())); }

  private async forwarded<T>(read: (remote: { outline: string; machine: string; client: OutlinerClient }) => Promise<T>, away: Map<string, AwayMachine>, deadline: number): Promise<T[]> {
    const layout = outlineLayout(this.folder);
    const config = mirrorsConfig(process.env);
    const files = (folder: string) => existsSync(folder) ? readdirSync(folder) : [];
    // `<machine>.link.sock` is what `<machine>.sock` routes to: the same host, not a machine of its own to ask again.
    const machines = new Set(files(layout.remoteDir).filter(f => f.endsWith(".sock") && !f.endsWith(".link.sock")).map(f => f.slice(0, -5)));
    if (!("error" in config)) for (const entry of config.mirrors) machines.add(entry.machine);
    const answers = await Promise.all([...machines].sort().map(async machine => {
      const copies = "error" in config ? [] : [...new Set([
        ...config.mirrors.filter(m => m.machine === machine).map(m => m.outline),
        ...[join(config.folder, machine), join(config.folder, ".restic", machine)].flatMap(folder => files(folder).filter(f => f.endsWith(".sqlite") && !f.endsWith(".owner.sqlite")).map(f => f.slice(0, -7))),
      ])];
      const copy = async (outline: string): Promise<T | undefined> => {
        if ("error" in config) return;
        const key = `${machine}/${outline}`;
        let mirror = this.mirrors.get(key);
        if (!mirror) {
          mirror = new OutlineMirror(outline, machine, config.folder, {
            schema: () => SCHEMA_VERSION,
            // The copy's own reads answer within the caller's deadline; the mirror reads its newest change itself.
            attach: async (socket, name) => ({ board: new OutlinerClient(socket, 1000, name), close() {} }),
          });
          this.mirrors.set(key, mirror);
        }
        const snapshot = await mirror.read();
        if ("error" in snapshot) return;
        const value = await read({ outline, machine, client: snapshot.board });
        const previous = away.get(machine)?.asOf;
        away.set(machine, { machine, asOf: previous && previous < snapshot.asOf ? previous : snapshot.asOf });
        return value;
      };
      const fallback = async (outlines: string[]) => {
        if (!away.has(machine)) away.set(machine, { machine });
        const results = await Promise.allSettled(outlines.map(copy));
        return results.flatMap(r => r.status === "fulfilled" && r.value !== undefined ? [r.value] : []);
      };
      let names: string[];
      if (this.silent.has(machine)) { this.probe(machine, layout.remote(machine).socket); return fallback(copies); }
      const remaining = deadline - Date.now();
      try {
        if (remaining <= 0) throw new Error("machine read deadline");
        const list = await new OutlinerClient(layout.remote(machine).socket, remaining).request<HostedOutlineList>({ action: "outlines.list" });
        names = list.outlines.map(o => o.name);
        this.silent.delete(machine);
      } catch {
        // Only a machine given a fair second is silent: a read that spent its deadline on earlier lookups says nothing.
        if (remaining >= FAIR_CHANCE_MS) this.silent.set(machine, { next: Date.now() + SILENT_FOR_MS });
        return fallback(copies);
      }
      const results = await Promise.all(names.map(async outline => {
        try {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error("machine read deadline");
          return [await read({ outline, machine, client: new OutlinerClient(layout.remote(machine).socket, remaining, outline) })];
        } catch { return fallback([outline]); }
      }));
      return results.flat();
    }));
    return answers.flat();
  }

  async read(from: string, request: OutlinerRequest): Promise<{ result: unknown } | undefined> {
    if (!["references.resolve", "pages.resolve", "pages.complete", "references.backlinks", "transclusions.read", "blocks.authored-links"].includes(request.action)) return;
    const local = await this.open(from);
    const away = new Map<string, AwayMachine>();
    // Leave room within the caller's three-second timeout for the copy and local rendering.
    const deadline = Date.now() + 1500;
    const remotes = <T>(read: (remote: { outline: string; machine: string; client: OutlinerClient }) => Promise<T>) => this.forwarded(read, away, deadline);
    const contexts = (id: string, outline?: string) => remotes(async remote => {
      if (outline && remote.outline !== outline) return null;
      const block = await remote.client.request<Block | null>({ action: "get", blockId: id });
      return block ? { block, outline: remote.outline, machine: remote.machine } : null;
    });
    // Every other outline, opened only when this read needs one: a note whose links are all here opens nothing (PIE-1610).
    let everyOther: Promise<{ name: string; store: OutlinerStore }[]> | undefined;
    const others = () => everyOther ??= Promise.all(this.names().filter(n => n !== from).map(async name => ({ name, store: await this.open(name) })));
    const here = { name: from, store: local };
    if (request.action === "blocks.authored-links") {
      const locations = new Map<string, { outline: string; machine?: string }>();
      const owner = local.get(request.ownerBlockId);
      const remoteBlocks = new Map<string, Block>();
      const remotePages = new Map<string, import("./types").PageAddressResolution>();
      if (owner) {
        const resolved = (await this.read(from, { id: request.id, action: "references.resolve", text: owner.text }))!.result as import("./types").ResolvedBlockReferences;
        for (const ref of resolved.references) if (ref.block && ref.outline) {
          remoteBlocks.set(`${ref.requestedOutline ?? ""}:${ref.blockId}`, ref.block);
          locations.set(ref.blockId, { outline: ref.outline, machine: ref.machine });
        }
        for (const page of pageAddressReferences(owner.text)) if (page.outline && !this.names().includes(page.outline)) {
          remotePages.set(page.displayAddress, (await this.read(from, { id: request.id, action: "pages.resolve", address: page.displayAddress }))!.result as import("./types").PageAddressResolution);
        }
      }
      let elsewhere = false;
      const readWith = (stores: readonly { name: string; store: OutlinerStore }[]) => readAuthoredLinks({
        referenceValues: id => local.referenceValues(id),
        resourceProviders: local.resourceProviders,
        resources: local.resources,
        extensionRecords: filter => local.extensionRecords(filter),
        facetRules: () => local.facetRules(),
        workIdAllocatorStatus: () => local.workIdAllocatorStatus(),
        addressOf: id => locations.get(id),
        get: (id, outline) => {
          for (const entry of stores) {
            if (outline && entry.name !== outline) continue;
            const block = entry.store.get(id);
            if (block) { if (entry.name !== from || outline) locations.set(id, { outline: entry.name }); return block; }
          }
          const remote = remoteBlocks.get(`${outline ?? ""}:${id}`) ?? null;
          if (!remote) elsewhere = true;
          return remote;
        },
        resolvePageAddress: address => {
          if (remotePages.has(address)) return remotePages.get(address)!;
          const q = qualifiedReference(address);
          const entry = stores.find(s => s.name === (q.outline ?? from));
          if (!entry) { elsewhere = true; return { address, normalizedAddress: normalizePageAddress(address).normalizedAddress, status: "missing" }; }
          return { ...entry.store.resolvePageAddress(q.target), ...(q.outline ? { outline: q.outline } : {}) };
        },
      }, request.ownerBlockId);
      const first = readWith([here]);
      return { result: elsewhere ? readWith([here, ...await others()]) : first };
    }
    if (request.action === "transclusions.read") {
      const locations = new Map<string, { outline: string; machine?: string }>();
      const result = await readTransclusionsAsync(async id => {
        const page = embeddedPageAddress(id);
        if (page !== null) {
          // Page links already reach forwarded hosts; embeds must ask that same route.
          const read = await this.read(from, { id: request.id, action: "pages.resolve", address: page });
          const resolved = read ? read.result as import("./types").PageAddressResolution : local.resolvePageAddress(page);
          if (resolved.outline) locations.set(id, { outline: resolved.outline, machine: resolved.machine });
          return resolved.block ?? null;
        }
        const q = qualifiedReference(id);
        const look = ({ name, store }: { name: string; store: OutlinerStore }) => {
          if (q.outline && q.outline !== name) return null;
          const block = store.get(q.target);
          if (block) locations.set(id, { outline: name });
          return block;
        };
        const nearby = look(here);
        if (nearby) return nearby;
        for (const entry of await others()) {
          const block = look(entry);
          if (block) return block;
        }
        if (BLOCK_ID_PATTERN.test(q.target) && (!q.outline || !this.names().includes(q.outline))) {
          const found = (await contexts(q.target, q.outline)).find(r => r !== null);
          if (found) { locations.set(id, { outline: found.outline, machine: found.machine }); return found.block; }
        }
        return null;
      }, request.targets, { hostBlockId: request.hostBlockId, maxDepth: request.maxDepth });
      const mark = async (node: import("./transclusions").TransclusionNode) => {
        const address = locations.get(node.blockId);
        if (address && (address.outline !== from || address.machine || qualifiedReference(node.blockId).outline)) {
          Object.assign(node, address);
          if (node.title) node.title = `${address.outline} · ${node.title}`;
        }
        const page = embeddedPageAddress(node.blockId);
        if (page !== null && (node.status === "missing" || node.status === "fragment-missing")) {
          const q = qualifiedReference(page);
          const store = !q.outline || q.outline === from ? local : this.names().includes(q.outline) ? await this.open(q.outline) : undefined;
          if (store) {
            const prefix = q.outline ? `${q.outline}:` : "";
            const literal = node.fragmentId ? [`${q.target}^${node.fragmentId}`, `${q.target} ^${node.fragmentId}`]
              .map(name => store.resolvePageAddress(name)).find(r => r.status === "resolved") : undefined;
            if (literal?.block) {
              node.message += ` · ^${node.fragmentId} reads as an anchor; for the page “${literal.address}”, use !((${prefix}${literal.block.id}))`;
            } else if (node.status === "missing") {
              const found = store.lookupBlockRef(`[[${q.target}]]`);
              if (found.kind === "missing" && found.didYouMean) {
                const near = pageAddressReferences(found.didYouMean).map(p => {
                  if (!p.fragmentId) return `[[${prefix}${p.displayAddress}]]`;
                  const name = found.didYouMean!.slice(p.start + 2, p.end - 2), literal = store.resolvePageAddress(name);
                  return `!((${prefix}${literal.block!.id})) (page “${name}”; ^${p.fragmentId} reads as an anchor)`;
                }).join(" or ");
                node.message += ` · did you mean ${near}?`;
              }
            }
          } else {
            // The target's host owns its suggestions too; keep its page qualifier in the warning.
            const reads = await remotes(async remote => remote.outline === q.outline
              ? remote.client.request<import("./transclusions").TransclusionRead>({ action: "transclusions.read", targets: [{ blockId: node.blockId, fragmentId: node.fragmentId }] }) : null);
            const message = reads.find(r => r !== null)?.results[0]?.message;
            if (message) node.message = message;
          }
        }
        await Promise.all((node.embeds ?? []).map(mark));
      };
      await Promise.all(result.results.map(mark));
      return { result };
    }
    if (request.action === "references.resolve") {
      const result = local.resolveBlockReferences(request.text);
      const occurrences = blockReferenceOccurrences(request.text);
      const references = await Promise.all(occurrences.map(async ref => {
        const candidates = ref.outline ? [ref.outline] : [from, ...(BLOCK_ID_PATTERN.test(ref.blockId) ? this.names().filter(n => n !== from) : [])];
        let answer: BlockReferenceResolution = { blockId: ref.blockId, fragmentId: ref.fragmentId, label: ref.label, status: "missing", ...(ref.outline ? { outline: ref.outline, requestedOutline: ref.outline } : {}) };
        for (const name of candidates) {
          if (!this.names().includes(name)) continue;
          const store = await this.open(name);
          const found = store.resolveBlockReferences(`((${ref.blockId}${ref.fragmentId ? `^${ref.fragmentId}` : ""}${ref.label ? `|${ref.label}` : ""}))`).references[0]!;
          if (found.status === "missing") continue;
          answer = { ...found, ...(name !== from || ref.outline ? { block: store.get(found.blockId)! } : {}), ...(name !== from || ref.outline ? { outline: name } : {}), ...(ref.outline ? { requestedOutline: ref.outline } : {}) };
          break;
        }
        if (answer.status === "missing" && BLOCK_ID_PATTERN.test(ref.blockId) && (!ref.outline || !this.names().includes(ref.outline))) {
          const remote = (await contexts(ref.blockId, ref.outline)).find(r => r !== null);
          if (remote) {
            const block = remote.block;
            const found = resolveBlockReferencesWithStatus(`((${ref.blockId}${ref.fragmentId ? `^${ref.fragmentId}` : ""}${ref.label ? `|${ref.label}` : ""}))`, () => block).references[0]!;
            answer = { ...found, block, outline: remote.outline, machine: remote.machine, ...(ref.outline ? { requestedOutline: ref.outline } : {}) };
          }
        }
        return answer;
      }));
      let text = "", at = 0;
      for (const [i, ref] of occurrences.entries()) {
        text += request.text.slice(at, ref.start) + blockReferenceDisplayText(references[i]!);
        at = ref.end;
      }
      return { result: { ...result, references, away: [...away.values()], text: text + request.text.slice(at) } };
    }
    if (request.action === "pages.resolve") {
      const { outline, target } = qualifiedReference(request.address);
      if (!outline) return;
      if (!this.names().includes(outline)) {
        const result = (await remotes(async remote => remote.outline === outline ? { ...await remote.client.request<import("./types").PageAddressResolution>({ action: "pages.resolve", address: target }), outline, machine: remote.machine } : null)).find(r => r !== null);
        if (result) return { result: { ...result, away: [...away.values()] } };
        return { result: { address: request.address, normalizedAddress: normalizePageAddress(request.address).normalizedAddress, outline, status: "missing" } };
      }
      return { result: { ...(await this.open(outline)).resolvePageAddress(target), outline } };
    }
    if (request.action === "pages.complete") {
      const { outline, target } = qualifiedReference(request.query ?? "");
      if (!outline) {
        if (request.semantic) return;
        return { result: { ...local.completePageAddresses(request.query, request.limit, request.contextBlockId), outlines: [...new Set([...this.names(), ...await remotes(async r => r.outline)])].filter(n => n !== from && n.startsWith(request.query ?? "")) } };
      }
      if (!this.names().includes(outline)) {
        const result = (await remotes(async remote => remote.outline === outline ? remote.client.request<import("./types").PageAddressCollection>({ action: "pages.complete", query: target, limit: request.limit }) : null)).find(r => r !== null);
        if (!result) return { result: { addresses: [], away: [...away.values()], completeness: { kind: "complete" } } };
        return { result: { ...result, addresses: result.addresses.map(a => ({ ...a, address: `${outline}:${a.address}`, normalizedAddress: `${outline}:${a.normalizedAddress}` })) } };
      }
      const result = (await this.open(outline)).completePageAddresses(target, request.limit);
      return { result: { ...result, addresses: result.addresses.map(a => ({ ...a, address: `${outline}:${a.address}`, normalizedAddress: `${outline}:${a.normalizedAddress}` })) } };
    }
    if (request.action === "references.backlinks") {
      if (request.sourceTarget) {
        const { block, outline, addresses } = request.sourceTarget;
        return { result: local.queryBacklinksAcross(request.query, block, new Map(addresses.map(a => [a, block.id])), outline) };
      }
      const target = local.get(request.query.targetBlockId);
      if (!target) return;
      const pages = local.pageAddressesOf(target.id);
      const sources = [];
      let truncated = false;
      for (const name of [from, ...this.names().filter(n => n !== from)]) {
        const addresses = new Map(pages.flatMap(p => [
          [`${from}:${p.normalizedAddress}`, target.id] as [string, string],
          ...(name === from ? [[p.normalizedAddress, target.id] as [string, string]] : []),
        ]));
        const result = (await this.open(name)).queryBacklinksAcross(request.query, target, addresses, from, name === from);
        sources.push(...result.sources.map(s => ({ ...s, ...(name !== from ? { outline: name } : {}) })));
        truncated ||= result.completeness.kind === "truncated";
      }
      const remoteResults = await remotes(async remote => {
        const result = await remote.client.request<import("./types").BacklinkCollection>({ action: "references.backlinks", query: request.query, sourceTarget: { block: target, outline: from, addresses: pages.map(p => `${from}:${p.normalizedAddress}`) } });
        return { ...result, sources: result.sources.map(source => ({ ...source, outline: remote.outline, machine: remote.machine })) };
      });
      for (const result of remoteResults) {
        sources.push(...result.sources);
        truncated ||= result.completeness.kind === "truncated";
      }
      return { result: { targetBlockId: target.id, away: [...away.values()], ...(target.effectiveDeletedRootId ? { targetDeletedRootId: target.effectiveDeletedRootId } : {}), sources: sources.slice(0, request.query.limit), completeness: truncated || sources.length > request.query.limit ? { kind: "truncated", limit: request.query.limit } : { kind: "complete" } } };
    }
  }
}
