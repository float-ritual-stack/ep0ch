import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Real hc with its own core, configuration and home; no configured route to another machine. */
export class ScratchCore {
  readonly dir: string;
  readonly env: Record<string, string | undefined>;
  constructor() {
    const base = `/tmp/ep0ch-agent-${process.getuid?.() ?? 1000}`;
    mkdirSync(base, { recursive: true, mode: 0o700 });
    this.dir = mkdtempSync(join(base, "named-"));
    this.env = { ...process.env };
    for (const key of Object.keys(this.env)) if (key.startsWith("HC_") || key.startsWith("EP0CH_")) delete this.env[key];
    Object.assign(this.env, { HC_SESSION: "scratch", HOME: join(this.dir, "home"), XDG_CONFIG_HOME: join(this.dir, "cfg"), XDG_STATE_HOME: join(this.dir, "state"), XDG_RUNTIME_DIR: join(this.dir, "run"), EP0CH_OUTLINES: join(this.dir, "outlines"), EP0CH_STATE: join(this.dir, "door"), EP0CH_DAEMON: "0", SHELL: "/bin/sh" });
    for (const folder of ["home", "run", ".ep0ch", "plot"]) mkdirSync(join(this.dir, folder), { mode: 0o700 });
    writeFileSync(join(this.dir, ".ep0ch/config.toml"), 'ws = "garden"\nagent = "fern"\n');
    writeFileSync(join(this.dir, "fern.sh"), `#!/bin/sh
printf '\x1b]7501;state=idle:app=claude-code\x1b\\'
echo "Fern ready: $EP0CH_WS / $EP0CH_AGENT / $OUTLINER_ACTOR"
if [ -n "$EP0CH_CONTROL" ]; then echo "Door binding: $EP0CH_CONTROL"; else echo "Door binding: unbound"; fi
while IFS= read -r line; do
  case "$line" in
    quit) echo 'Fern finished the garden plan'; exit 7;;
    work) printf '\x1b]7501;state=working:app=claude-code\x1b\\';;
    ready) printf '\x1b]7501;state=idle:app=claude-code\x1b\\';;
    *) echo "Fern heard: $line";;
  esac
done
`);
    writeFileSync(join(this.dir, ".ep0ch/agents.toml"), `[[agent]]\npersona = "fern"\nfolder = ${JSON.stringify(this.dir)}\nprogram = ${JSON.stringify(`/bin/sh ${join(this.dir, "fern.sh")}`)}\n`);
  }
  async run(args: string[], env = this.env) {
    const p = Bun.spawn(args, { env, cwd: this.dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  }
  hc(...args: string[]) { return this.run(["hc", ...args]); }
  ep0ch(...args: string[]) { return this.run([process.execPath, resolve(import.meta.dir, "../src/main.ts"), ...args]); }
  async dispose() {
    const listed = await this.hc("ls");
    if (listed.code === 0) for (const t of JSON.parse(listed.out).terminals) {
      await this.hc("keys", t.address, "q", "u", "i", "t", "enter", "ctrl+d");
    }
    await this.hc("server", "stop");
  }
}
