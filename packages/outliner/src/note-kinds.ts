import type { Block } from "./types";

/** Content categories offered to automated writers. Managed records keep their own contracts. */
export const NOTE_TYPES = [
  "note", "idea", "design-note", "decision", "finding", "feedback", "review",
  "implementation-proof", "progress", "reference", "synthesis", "hub",
] as const;


const managedTypes = new Set([
  "roadmap-item", "work-batch", "delivery", "work-queue", "workboard", "work-item",
  "virtual-branch", "relation-view", "bookmark", "inbox", "capture-queue", "capture-archive",
  "hub-maintenance-spec", "generated-section", "artifact-summary", "workspace",
]);

export function isManagedNote(block: Block): boolean {
  if (block.author === "system") return true;
  return block.properties.some(property =>
    ["system-view", "system-doc", "work-id", "work-stage", "delivery-key", "generated-by"].includes(property.key) ||
    (property.key === "type" && (managedTypes.has(property.value.toLowerCase()) || property.value.toLowerCase().startsWith("annotation"))),
  );
}
