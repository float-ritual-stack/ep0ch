// An ssh-shaped boundary, shared by the scratch walkthrough. No command is executed.
import { readFileSync, writeFileSync } from "node:fs";
const [file, mode, ...args] = process.argv.slice(2);
const state = JSON.parse(readFileSync(file!, "utf8"));
const at = args.indexOf("--");
const machine = mode === "local" ? "garden" : args[at + 1]!;
const command = mode === "local" ? await Bun.stdin.text() : args[at + 2]!;
if (machine === "notebook" && state.asleep) process.exit(255);
if (/^(docker restart|systemctl --user restart)/.test(command.trim())) {
  state.restarts.push(`${machine}:${command.trim()}`);
  state.free = 8 * 1024 ** 3;
  state.failed = false;
  writeFileSync(file!, JSON.stringify(state));
  process.exit(0);
}
const id = "a".repeat(64);
console.log(`@@mem
              total used free shared buff/cache available
Mem: 68719476736 60000000000 500000000 0 0 ${state.free}
@@load
1.2 0.8 0.5 1/40 999
@@cpus
8
@@disk
Filesystem 1B-blocks Used Available Use% Mounted on
/dev/madeup 100000000000 20000000000 80000000000 20% /
@@failed
${state.failed ? "garden-cache.service loaded failed failed Cache" : ""}
@@top
4242 49283072 /opt/tempo
4243 100000 /opt/grafana
4244 50000 /opt/outliner-host
@@cgroup
4242 0::/${state.command === "docker" ? `system.slice/docker-${id}.scope` : "user.slice/user-1000.slice/user@1000.service/app.slice/garden-cache.service"}
@@docker
${id} kiln-tempo
@@end`);
