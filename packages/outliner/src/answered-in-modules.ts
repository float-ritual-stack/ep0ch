/*
 * The wire actions a module answers whole. `server.ts` owns dispatch and hands a request over here once; an action
 * whose handler lives in a module of its own gets its case here, so server.ts and types.ts stay as long as they are.
 * Each handler asks the service itself (`own`) for what it reads and writes, so it takes a turn like any request.
 *
 * - `notes.page`: everything a client draws of one note (note-page.ts).
 * - `screens.list`, `screens.save`: the outline's screens (screens.ts).
 * - `lists.read`: one list, whatever it is of (list-producers.ts).
 * - `tiles.view`: what a tile an extension's script renders shows (tile-view.ts).
 * - `passages.find`: where a quoted passage is in a note's text, before anything is written about it (passage-find.ts).
 * - `outlines.known`: the outlines there are to open. The host answers it before it gets here (outline-links.ts); a
 *   service no host runs knows only its own.
 *
 * A read here that is asked with `watch` is kept by `QueryWatches.askLater`: answered now, and again on each pass
 * that reaches it, with `queries.changed` when the answer moved.
 */
import type { OutlinerResponse } from "@ep0ch/outline-core/protocol";
import { isWatchedLater } from "./actions";
import { readList } from "./list-producers";
import { servedPage } from "./note-page";
import { foundPassage } from "./passage-find";
import type { QueryWatches, WatchConnection } from "./query-watches";
import { refusalEnvelope } from "./request-envelope";
import { listScreens, saveScreen } from "./screens";
import { readTileView } from "./tile-view";
import type { OutlinerRequest } from "./types";

/**
 * The requests the modules here answer, as one member of the wire's union: a module's request type is added here,
 * never to types.ts (which is capped, and names this once).
 */
export type ModuleRequest = import("./screens").ScreensRequest | import("./list-producers").ListsRequest | import("./tile-view").TileViewRequest | import("./outline-links").KnownOutlinesRequest | import("./passage-find").PassageFindRequest;

/** What a module's handler is given of the service. */
export interface ModuleHost {
  own: { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
  watches: QueryWatches;
  sequence(): number;
  require(id: string): { id: string; text: string; revision: number; effectiveDeletedRootId?: string | null };
  /** The outline's name and its machine's, as a page says where it is. */
  address(): { outline?: string; machine: string };
}

/** `result`'s answer, kept and asked again on each pass when the request says `watch` and the action's row says it is watched (`watch: "later"`). */
function answered(request: { id: string; action: string; watch?: unknown }, connection: WatchConnection | undefined, host: ModuleHost, result: () => Promise<unknown>): Promise<OutlinerResponse> {
  const answer = (id: string): Promise<OutlinerResponse> => result().then(value => ({ id, ok: true as const, result: value, sequence: host.sequence() }) as OutlinerResponse, error => refusalEnvelope(id, error, host.sequence()));
  return connection && request.watch !== undefined && isWatchedLater(request.action) ? host.watches.askLater(connection, request as unknown as Parameters<QueryWatches["askLater"]>[1], asked => answer(asked.id)) : answer(request.id);
}

/** The answer to a request a module answers, or null: the request is the server's own to answer. */
export function answeredInModule(request: OutlinerRequest, connection: WatchConnection | undefined, host: ModuleHost): Promise<OutlinerResponse> | null {
  switch (request.action) {
    case "notes.page": return answered(request, connection, host, () => servedPage(host.own, host.require, request.blockId, host.address()));
    case "screens.list": return answered(request, connection, host, () => listScreens(host.own, request));
    case "screens.save": return answered(request, connection, host, () => saveScreen(host.own, request));
    case "lists.read": return answered(request, connection, host, () => readList(host.own, request));
    case "tiles.view": return answered(request, connection, host, () => readTileView(host.own, request));
    case "passages.find": return answered(request, connection, host, async () => foundPassage(host.require, request));
    case "outlines.known": return answered(request, connection, host, async () => { const { outline } = host.address(); return { outlines: outline ? [{ name: outline, here: true }] : [] }; });
    default: return null;
  }
}
