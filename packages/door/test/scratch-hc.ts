import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** Real hc, with no route to the person's core or configured machines. */
export class ScratchCore {
  readonly dir = mkdtempSync(join(tmpdir(), "hc-"));
  readonly env: Record<string, string | undefined>;
  constructor() {
    this.env = { ...process.env };
    for (const k of Object.keys(this.env)) if (k.startsWith("HC_") || k.startsWith("EP0CH_")) delete this.env[k];
    Object.assign(this.env, { HC_SESSION: "scratch", HOME: join(this.dir, "home"), CLAUDE_CONFIG_DIR: join(this.dir, "home/.claude"), XDG_CONFIG_HOME: join(this.dir, "config"), XDG_STATE_HOME: join(this.dir, "state"), XDG_RUNTIME_DIR: join(this.dir, "run"), EP0CH_OUTLINES: join(this.dir, "outlines"), EP0CH_STATE: join(this.dir, "door"), EP0CH_DAEMON: "0" });
    mkdirSync(this.env.HOME!, { recursive: true });
    mkdirSync(join(this.dir, "run"), { mode: 0o700 });
    mkdirSync(join(this.dir, ".ep0ch"));
    writeFileSync(join(this.dir, ".ep0ch/config.toml"), 'ws = "garden"\nagent = "fern"\n');
    writeFileSync(join(this.dir, "agent.sh"), '#!/bin/sh\nprintf "\\033]7501;state=idle:app=claude-code\\033\\\\"\necho "fern ready"\nwhile IFS= read -r line; do\n  case "$line" in\n    quit) echo "fern finished"; exit 7;;\n    work) printf "\\033]7501;state=working:app=claude-code\\033\\\\";;\n    *) echo "fern heard: $line";;\n  esac\ndone\n');
    writeFileSync(join(this.dir, ".ep0ch/agents.toml"), `[[agents]]\npersona = "fern"\nmachine = "local"\nfolder = ${JSON.stringify(this.dir)}\nprogram = ["/bin/sh", ${JSON.stringify(join(this.dir, "agent.sh"))}]\n`);
  }
  async run(args: string[]) {
    const p = Bun.spawn(args, { env: this.env, cwd: this.dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  }
  hc(...args: string[]) { return this.run(["hc", ...args]); }
  ep0ch(...args: string[]) { return this.run([process.execPath, resolve(import.meta.dir, "../src/main.ts"), ...args]); }
  async dispose() {
    const r = await this.hc("ls");
    if (r.code === 0) for (const t of JSON.parse(r.out).terminals) await this.hc("keys", t.address, "ctrl+d");
    await this.hc("server", "stop");
  }
}
