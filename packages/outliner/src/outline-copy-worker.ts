// The host's copy of an outline (PIE-1750), in a worker of its own: its own read-only connection makes the copy
// (VACUUM INTO, one read transaction, so a consistent copy while the store writes on), and the facts are read from the
// copy, so they describe exactly what it holds. The host's loop is never held by it. Started by `copyOutlineFile`.
import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { outlineFileFacts } from "./outline-file";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ path: string; dest: string }>) => {
  const { path, dest } = event.data;
  try {
    const source = new Database(path, { readonly: true });
    try { source.run("VACUUM INTO ?", [dest]); } finally { source.close(); }
    chmodSync(dest, 0o600);
    const copy = new Database(dest, { readonly: true });
    try { postMessage({ ok: true, facts: outlineFileFacts(copy) }); } finally { copy.close(); }
  } catch (error) {
    postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
