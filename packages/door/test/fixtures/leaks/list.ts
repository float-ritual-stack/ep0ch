// One made-up extension with one action, as the service lists it.
import type { ExtensionList } from "../../../src/extensions";

export const list = {
  generation: 1, tileKinds: [], resourceProviders: [],
  extensions: [{ id: "tarot", name: "Tarot", version: 1, state: "active", handlers: [], actions: [{ id: "draw", name: "ext.tarot.draw", label: "Draw a card" }] }],
} as unknown as ExtensionList;
