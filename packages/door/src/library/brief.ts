// The component library for an agent (`ep0ch library --brief`, the gateway's `outline_components` and its component
// resources): outline-core's `componentBriefs` over the schemas the service merges (`components.schemas`), the one source.
import { componentBriefs, type ComponentSchema } from "@ep0ch/outline-core/component-schema";

/** The schemas named (all when none are), or the names that aren't components. */
export function chooseComponents(all: readonly ComponentSchema[], names: readonly string[]): { chosen: ComponentSchema[] } | { error: string } {
  const missing = names.filter(n => !all.some(s => s.id === n));
  if (missing.length) return { error: `no component ${missing.join(", ")}; components: ${all.map(s => s.id).join(", ")}` };
  return { chosen: names.length ? all.filter(s => names.includes(s.id)) : [...all] };
}

/** The brief for the components named (all when none are). */
export function briefFor(all: readonly ComponentSchema[], names: readonly string[]): { text: string } | { error: string } {
  const r = chooseComponents(all, names);
  return "error" in r ? r : { text: componentBriefs(r.chosen) };
}
