import { readFileSync } from "node:fs";
import { PROTOCOL, GRAMMAR } from "@ep0ch/outline-core/protocol";

export interface CodeRules { protocol: number; grammar: number }
export const runningRules: CodeRules = { protocol: PROTOCOL, grammar: GRAMMAR };

/** Read the checkout, not this process's cached import: install replaces its files beneath a running client. */
export function installedRules(file = new URL("../../outline-core/src/protocol.ts", import.meta.url)): CodeRules {
  const source = readFileSync(file, "utf8");
  return {
    protocol: Number(/^export const PROTOCOL = (\d+);/m.exec(source)![1]),
    grammar: Number(/^export const GRAMMAR = (\d+);/m.exec(source)![1]),
  };
}
export const newerRules = (next: CodeRules, was: CodeRules) => next.protocol > was.protocol || next.grammar > was.grammar;

/** The session daemon supplies its checkpointed handover; a standalone client can replace itself before opening a terminal. */
export const clientReload: { handover?: () => Promise<unknown> } = {};
export async function meetRules(host: { protocolVersion: number; grammarVersion: number }): Promise<void> {
  if (!newerRules({ protocol: host.protocolVersion, grammar: host.grammarVersion }, runningRules)) return;
  if (!clientReload.handover) return;
  const installed = installedRules();
  if (installed.protocol === host.protocolVersion && newerRules(installed, runningRules))
    await clientReload.handover();
}

export function reexecClient(): never {
  process.execve!(process.execPath, [process.execPath, ...process.argv.slice(1)], process.env as Record<string, string>);
  throw new Error("could not reload ep0ch; run ep0ch install --apply");
}
