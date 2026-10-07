// The outline's component schemas in the door (PIE-618): outline-core's built-ins with the outline's own styles and
// types among their values, and the extensions' (`components.schemas`), kept per connection as the callout types are
// (src/outline-lists.ts). The completer offers keys and values from them, and the library draws a page for each.
import { BUILTIN_COMPONENT_SCHEMAS, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { outlineList } from "./outline-lists";

type SchemaBoard = { componentSchemas?: () => Promise<{ schemas: ComponentSchema[]; problems: string[] }> };

const SCHEMAS = outlineList<ComponentSchema, readonly ComponentSchema[]>(
  (b: SchemaBoard) => (typeof b.componentSchemas === "function" ? () => b.componentSchemas!().then(r => ({ items: r.schemas, problems: r.problems })) : undefined),
  items => items, BUILTIN_COMPONENT_SCHEMAS,
);

/** The component schemas for this connection: the built-ins until (and unless) the service answers. */
export const componentsOf = SCHEMAS.of;
/** The schemas once the question out now (if any) is answered: what the completer offers. */
export const componentsReady = SCHEMAS.ready;
/** Which answer `componentsOf` gives now, for a cache of what was drawn with it. */
export const componentsStamp = SCHEMAS.stamp;
/** The extensions changed (`extensions` event): their components are asked for again, the last answer kept till then. */
export const componentsChanged = SCHEMAS.stale;
