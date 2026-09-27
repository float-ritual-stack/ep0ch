import {mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {resolveClientConfigPath} from "./paths";
import type {ReaderDensity} from "./reader-chrome";

/** Client-host preferences alongside the connection config; never canonical note data. */
export class ViewPreferences {
  density: ReaderDensity = "compact";
  readonly path: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.path = env.OUTLINER_VIEW_PREFERENCES_PATH?.trim() || join(dirname(resolveClientConfigPath(env)), "view.json");
    const record = this.read();
    if (record.density !== undefined && record.density !== "compact" && record.density !== "expanded") {
      throw new Error(`Invalid density in ${this.path}: expected compact or expanded`);
    }
    this.density = record.density as ReaderDensity ?? "compact";
  }

  private read(): Record<string, unknown> {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected a JSON object");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(`Could not read view preferences at ${this.path}`, {cause: error});
    }
  }

  setDensity(density: ReaderDensity): void {
    const value = {...this.read(), density};
    mkdirSync(dirname(this.path), {recursive: true});
    const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {mode: 0o600});
    renameSync(temporary, this.path);
    this.density = density;
  }
}
