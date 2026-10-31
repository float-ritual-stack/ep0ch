import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SEED } from "./names";

export function shellLineDemo(config?: string): string {
  const folder = config && join(config, "showcase-files");
  if (folder) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "beds.md"), "Garden beds\n");
    writeFileSync(join(folder, "seeds.md"), "Seeds to plant\n");
  }
  return [SEED.shLines, "", "Press x on the command or click run. Run again replaces its output; K keeps it as your text.",
    "Edit an output line, then run again: it asks before replacing your words.", "", ...(folder ? [`cwd:: ${folder}`, ""] : []),
    "sh:: ls | as files", "", "Try sh:: ls /nonexistent for the exit and stderr beside the line.",
    "| as completes ordinary script notes. [run::open] on the command opts into running each time you open this note."].join("\n");
}
