import { codeVersion as checkoutVersion } from "@ep0ch/outliner/program-env";
import { resolve } from "node:path";

/** The checkout this code runs from, and its commit (an upgrade compares them). */
export function codeVersion(dir = resolve(import.meta.dir, "../..")): { dir: string; commit: string | null } {
  return checkoutVersion(dir);
}
