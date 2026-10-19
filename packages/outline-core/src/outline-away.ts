/** A machine omitted from a fan-out, or answered from a read-only copy. */
export interface AwayMachine { machine: string; asOf?: string }

export function awayLine(away: AwayMachine): string {
  return `${away.machine}: away, ${away.asOf ? `from its copy as of ${away.asOf}` : "not asked"}`;
}
