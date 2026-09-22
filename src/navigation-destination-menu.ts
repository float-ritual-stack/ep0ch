import { sanitizeDynamicText } from "./terminal";
import type { OutlinerActionMenuItem } from "./outliner-actions";
import type { NavigationLinkState } from "./types";

/** Lists existing logical Details without resolving targets or touching Resources. */
export function navigationDestinationItems(state: NavigationLinkState, unlink: boolean): OutlinerActionMenuItem[] {
  const items: OutlinerActionMenuItem[] = state.destinations.map(({view, label, protection}, index) => ({
    id: `destination:${index}`, label: sanitizeDynamicText(`${label}${state.destination?.clientId === view.clientId ? " ← linked" : ""}`),
    description: sanitizeDynamicText(`${view.clientId} / ${view.region}${protection ? ` · protected: ${protection}` : ""}`),
    binding: "", group: "Pane",
  }));
  if (unlink) items.push({id: "destination:unlink", label: "Unlink destination", description: "Explicit Open will ask for a destination", binding: "", group: "Pane"});
  return items;
}
