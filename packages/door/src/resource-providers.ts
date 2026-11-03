// The service's resource providers (`extensions.list`'s `resourceProviders`: Jira's, and any extension's with a
// `kind: "resource"` handler), as the extension binding last read them. A leaf module with no imports, so the readers
// that filter on their keys (refs.ts, projection.ts) don't import the binding and its tile kinds.

/** An extension provider of Resources: `jira::` lines and `[jira::KEY]` tokens name its entities. */
/** A resource handler as `extensions.list` lists it (the wire contract's). */
export type ResourceProviderEntry = import("@ep0ch/outliner/wire").WireAnswer<"extensions.list">["resourceProviders"][number];

let providers: readonly ResourceProviderEntry[] = [];

/** What the binding read (src/extensions.ts `bindExtensions`). */
export function useResourceProviders(next: readonly ResourceProviderEntry[]): void {
  providers = next;
}

/** The property keys of the service's resource providers (`jira`): a line or token with one may have a projection. */
export const resourceProviderKeys = (): string[] => providers.map(p => p.key);
