// The service's resource providers (`extensions.list`'s `resourceProviders`: Jira's, and any extension's with a
// `kind: "resource"` handler), as the extension binding last read them. A leaf module with no imports, so the readers
// that filter on their keys (refs.ts, projection.ts) don't import the binding and its tile kinds.

/** An extension provider of Resources: `jira::` lines and `[jira::KEY]` tokens name its entities. */
export interface ResourceProviderEntry { provider: string; key: string; label: string; keyPattern?: string; fields?: string[]; link?: string }

let providers: readonly ResourceProviderEntry[] = [];

/** What the binding read (src/extensions.ts `bindExtensions`). */
export function useResourceProviders(next: readonly ResourceProviderEntry[]): void {
  providers = next;
}

/** The property keys of the service's resource providers (`jira`): a line or token with one may have a projection. */
export const resourceProviderKeys = (): string[] => providers.map(p => p.key);
