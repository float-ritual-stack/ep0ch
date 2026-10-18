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

  private async forwarded() {
    const layout = outlineLayout(this.folder);
    const entries: { outline: string; machine: string; client: OutlinerClient }[] = [];
    if (!existsSync(layout.remoteDir)) return entries;
    for (const file of readdirSync(layout.remoteDir).filter(f => f.endsWith(".sock")).sort()) {
      const machine = file.slice(0, -5);
      const socket = layout.remote(machine).socket;
      const host = new OutlinerClient(socket);
      const list = await host.request<HostedOutlineList>({ action: "outlines.list" });
      for (const outline of list.outlines) entries.push({ outline: outline.name, machine, client: new OutlinerClient(socket, undefined, outline.name) });
    }
    return entries;
  }

  async read(from: string, request: OutlinerRequest): Promise<{ result: unknown } | undefined> {
    if (!["references.resolve", "pages.resolve", "pages.complete", "references.backlinks", "transclusions.read", "blocks.authored-links"].includes(request.action)) return;
    const local = await this.open(from);
    let remoteRead: ReturnType<OutlineLinks["forwarded"]> | undefined;
    const remotes = () => remoteRead ??= this.forwarded();
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
          for (const remote of await remotes()) {
            if (q.outline && remote.outline !== q.outline) continue;
            const context = await remote.client.request<{ selected: Block | null }>({ action: "blocks.context", blockId: q.target });
            if (context.selected) { locations.set(id, { outline: remote.outline, machine: remote.machine }); return context.selected; }
          }
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
      const references: BlockReferenceResolution[] = [];
      let text = "", at = 0;
      for (const ref of blockReferenceOccurrences(request.text)) {
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
          for (const remote of await remotes()) {
            if (ref.outline && remote.outline !== ref.outline) continue;
            const context = await remote.client.request<{ selected: Block | null }>({ action: "blocks.context", blockId: ref.blockId });
            if (!context.selected) continue;
            const block = context.selected;
            const found = resolveBlockReferencesWithStatus(`((${ref.blockId}${ref.fragmentId ? `^${ref.fragmentId}` : ""}${ref.label ? `|${ref.label}` : ""}))`, () => block).references[0]!;
            answer = { ...found, block, outline: remote.outline, machine: remote.machine, ...(ref.outline ? { requestedOutline: ref.outline } : {}) };
            break;
          }
        }
        references.push(answer);
        text += request.text.slice(at, ref.start) + blockReferenceDisplayText(answer);
        at = ref.end;
      }
      return { result: { ...result, references, text: text + request.text.slice(at) } };
    }
    if (request.action === "pages.resolve") {
      const { outline, target } = qualifiedReference(request.address);
      if (!outline) return;
      if (!this.names().includes(outline)) {
        const remote = (await remotes()).find(r => r.outline === outline);
        if (remote) return { result: { ...await remote.client.request<import("./types").PageAddressResolution>({ action: "pages.resolve", address: target }), outline, machine: remote.machine } };
        return { result: { address: request.address, normalizedAddress: normalizePageAddress(request.address).normalizedAddress, outline, status: "missing" } };
      }
      return { result: { ...(await this.open(outline)).resolvePageAddress(target), outline } };
    }
    if (request.action === "pages.complete") {
      const { outline, target } = qualifiedReference(request.query ?? "");
      if (!outline) {
        if (request.semantic) return;
        return { result: { ...local.completePageAddresses(request.query, request.limit, request.contextBlockId), outlines: [...new Set([...this.names(), ...(await remotes()).map(r => r.outline)])].filter(n => n !== from && n.startsWith(request.query ?? "")) } };
      }
      if (!this.names().includes(outline)) {
        const remote = (await remotes()).find(r => r.outline === outline);
        if (!remote) return { result: { addresses: [], completeness: { kind: "complete" } } };
        const result = await remote.client.request<import("./types").PageAddressCollection>({ action: "pages.complete", query: target, limit: request.limit });
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
      for (const remote of await remotes()) {
        const result = await remote.client.request<import("./types").BacklinkCollection>({ action: "references.backlinks", query: request.query, sourceTarget: { block: target, outline: from, addresses: pages.map(p => `${from}:${p.normalizedAddress}`) } });
        sources.push(...result.sources.map(source => ({ ...source, outline: remote.outline, machine: remote.machine })));
        truncated ||= result.completeness.kind === "truncated";
      }
      return { result: { targetBlockId: target.id, ...(target.effectiveDeletedRootId ? { targetDeletedRootId: target.effectiveDeletedRootId } : {}), sources: sources.slice(0, request.query.limit), completeness: truncated || sources.length > request.query.limit ? { kind: "truncated", limit: request.query.limit } : { kind: "complete" } } };
    }
  }
}
