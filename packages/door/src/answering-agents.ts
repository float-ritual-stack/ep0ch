// The agents that answer in comment threads, as the service last listed them. Its own module, with no imports:
// `agent.ask` and `tile.ask` read it from modules src/extensions.ts is itself built on.

/** An agent an installed extension answers as, in comment threads: its name, its tile-menu words and its extension's page. */
export interface AnsweringAgent { name: string; description?: string; ask?: string; page?: string }

let known: readonly AnsweringAgent[] = [];

/** src/extensions.ts says who answers, each time it binds the service's list. */
export function setAnsweringAgents(agents: readonly AnsweringAgent[]): void { known = agents; }

/** Who answers now: an `agent.ask` to one of them is answered at once. */
export const answeringAgents = (): readonly AnsweringAgent[] => known;
