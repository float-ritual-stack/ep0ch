// An enum property's values with their meanings, for the component schemas: its own file, so the schema files that
// component-schema.ts registers share it without importing that file back. Pure.
import type { PropValue } from "./component-schema";

export const enumOf = (meanings: Record<string, string>): PropValue[] => Object.entries(meanings).map(([value, meaning]) => ({ value, meaning }));
