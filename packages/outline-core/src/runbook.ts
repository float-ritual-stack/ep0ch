/** The extension owns step meaning; the door owns execution in the person's terminal. */
export interface RunbookField { name: string; secret: boolean; choices?: string[]; file?: boolean; value?: string }
export interface RunbookStep {
  block: string; root?: string; title: string; mode: "terminal" | "host";
  command: string; fields: RunbookField[]; secrets: string[];
  confirm?: string; on?: string; keep: boolean; close: boolean;
}
export interface RunbookPlan { steps: RunbookStep[] }

export interface RunbookResult { exit: number; output: string }
