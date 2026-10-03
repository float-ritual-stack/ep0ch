import { setTimeout as sleep } from "node:timers/promises";
import { protocolMismatch } from "@ep0ch/outline-core/protocol";
import type { OutlinerServiceStatus } from "./types";

/**
 * One check: the service speaks this checkout's PROTOCOL (outline-core). A
 * different number, older or newer, is refused with what to restart.
 */
export function checkServiceCompatibility(service: OutlinerServiceStatus): { message: string } | undefined {
  const message = protocolMismatch(service.protocolVersion, "this Outliner client");
  return message === undefined ? undefined : { message };
}

/** Throws the restart instruction when the service speaks another protocol. */
export function requireCompatible(service: OutlinerServiceStatus): void {
  const problem = checkServiceCompatibility(service);
  if (problem) throw new Error(problem.message);
}

interface PingClient {
  request<T>(input: { action: "ping" }, timeoutMs?: number): Promise<T>;
}

/**
 * Polls `ping` until a service speaking this protocol answers. An unreachable
 * or mismatched service is retried until the deadline, then the last reason
 * is reported, so a service that is restarting onto this checkout is accepted
 * while one on other code is still refused.
 */
export async function waitForCompatibleService(
  client: PingClient,
  options: { timeoutMs: number; pingTimeoutMs?: number },
): Promise<OutlinerServiceStatus> {
  const deadline = Date.now() + options.timeoutMs;
  let lastResponse = "No service response";
  do {
    try {
      const service = await client.request<OutlinerServiceStatus>({ action: "ping" }, options.pingTimeoutMs);
      const problem = checkServiceCompatibility(service);
      if (!problem) return service;
      lastResponse = problem.message;
    } catch (error) {
      lastResponse = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error(lastResponse);
}
