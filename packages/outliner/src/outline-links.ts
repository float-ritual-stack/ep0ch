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
import { blockReferenceOccurrences, pageAddressReferences, normalizePageAddress, qualifiedReference } from "@ep0ch/outline-core/link-syntax";
import { readTransclusionsAsync } from "./transclusions";
import { blockReferenceDisplayText } from "./references";
import type { OutlinerStore } from "./store";
import type { BlockReferenceResolution, OutlinerRequest } from "./types";

/** The host supplies stores; the per-outline server never opens another outline itself. */
export class OutlineLinks {
  constructor(private names: () => string[], private open: (name: string) => Promise<OutlinerStore>, private folder: string) {}

  private mirrors = new Map<string, OutlineMirror<OutlinerClient>>();

  async close() { await Promise.all([...this.mirrors.values()].map(m => m.close())); }

  private async forwarded<T>(read: (remote: { outline: string; machine: string; client: OutlinerClient }) => Promise<T>, away: Map<string, AwayMachine>, deadline: number): Promise<T[]> {
    const layout = outlineLayout(this.folder);
    const config = mirrorsConfig(process.env);
    const files = (folder: string) => existsSync(folder) ? readdirSync(folder) : [];
    const machines = new Set(files(layout.remoteDir).filter(f => f.endsWith(".sock")).map(f => f.slice(0, -5)));
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
            attach: async (socket, name) => {
              const client = new OutlinerClient(socket, 1000, name);
              const index = await client.request<{ blocks: { updatedAt: string }[] }>({ action: "tree.index" });
              return { board: client, newest: index.blocks.reduce((newest, b) => Math.max(newest, Date.parse(b.updatedAt)), 0), close() {} };
            },
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
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("machine read deadline");
        const list = await new OutlinerClient(layout.remote(machine).socket, remaining).request<HostedOutlineList>({ action: "outlines.list" });
        names = list.outlines.map(o => o.name);
      } catch { return fallback(copies); }
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
    if (request.action === "blocks.authored-links") {
      const stores = await Promise.all([from, ...this.names().filter(n => n !== from)].map(async name => ({ name, store: await this.open(name) })));
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
      return { result: readAuthoredLinks({
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
          return remoteBlocks.get(`${outline ?? ""}:${id}`) ?? null;
        },
        resolvePageAddress: address => {
          if (remotePages.has(address)) return remotePages.get(address)!;
          const q = qualifiedReference(address);
          const entry = stores.find(s => s.name === (q.outline ?? from));
          if (!entry) return { address, normalizedAddress: normalizePageAddress(address).normalizedAddress, status: "missing" };
          return { ...entry.store.resolvePageAddress(q.target), ...(q.outline ? { outline: q.outline } : {}) };
        },
      }, request.ownerBlockId) };
    }
    if (request.action === "transclusions.read") {
      const stores = await Promise.all([from, ...this.names().filter(n => n !== from)].map(async name => ({ name, store: await this.open(name) })));
      const locations = new Map<string, { outline: string; machine?: string }>();
      const result = await readTransclusionsAsync(async id => {
        const q = qualifiedReference(id);
        for (const { name, store } of stores) {
          if (q.outline && q.outline !== name) continue;
          const block = store.get(q.target);
          if (block) { locations.set(id, { outline: name }); return block; }
        }
        if (BLOCK_ID_PATTERN.test(q.target) && (!q.outline || !this.names().includes(q.outline))) {
          const found = (await contexts(q.target, q.outline)).find(r => r !== null);
          if (found) { locations.set(id, { outline: found.outline, machine: found.machine }); return found.block; }
        }
        return null;
      }, request.targets, { hostBlockId: request.hostBlockId, maxDepth: request.maxDepth });
      const mark = (node: import("./transclusions").TransclusionNode) => {
        const address = locations.get(node.blockId);
        if (address && (address.outline !== from || address.machine || qualifiedReference(node.blockId).outline)) {
          Object.assign(node, address);
          if (node.title) node.title = `${address.outline} · ${node.title}`;
        }
        node.embeds?.forEach(mark);
      };
      result.results.forEach(mark);
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
        const result = (await this.open(name)).queryBacklinksAcross(request.query, target, addresses, from);
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
