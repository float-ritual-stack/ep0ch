// An ssh-shaped boundary, shared by the scratch walkthrough. No command is executed.
import { readFileSync, writeFileSync } from "node:fs";
const [file, mode, ...args] = process.argv.slice(2);
const state = JSON.parse(readFileSync(file!, "utf8"));
const id = "a".repeat(64);
const memory = `              total used free shared buff/cache available\nMem: 68719476736 60000000000 500000000 0 0 ${state.free}`;
const disk = "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/madeup 100000000000 20000000000 80000000000 20% /";
const top = "4242 49283072 /opt/tempo\n4243 100000 /opt/grafana\n4244 50000 /opt/outliner-host";
const group = `0::/${state.command === "docker" ? `system.slice/docker-${id}.scope` : "user.slice/user-1000.slice/user@1000.service/app.slice/garden-cache.service"}`;
async function restart(machine: string, command: string) {
  if (state.restartDelay) await Bun.sleep(state.restartDelay);
  state.restarts.push(`${machine}:${command}`);
  state.free = 8 * 1024 ** 3;
  state.failed = false;
  writeFileSync(file!, JSON.stringify(state));
}
if (mode === "command") {
  const [name, ...words] = args;
  if (name === "systemctl" && (!process.env.XDG_RUNTIME_DIR || !process.env.DBUS_SESSION_BUS_ADDRESS || state.unitBusUnavailable)) {
    console.error("Failed to connect to user bus"); process.exit(1);
  }
  if ((name === "systemctl" && words.includes("restart")) || (name === "docker" && words[0] === "restart")) await restart("garden", [name, ...words].join(" "));
  else if (name === "uname") console.log("Linux");
  else if (name === "free") console.log(memory);
  else if (name === "cat") console.log("1.2 0.8 0.5 1/40 999");
  else if (name === "nproc") console.log("8");
  else if (name === "df") console.log(disk);
  else if (name === "ps") console.log(words.includes("pid") ? "4242\n4243\n4244" : top);
  else if (name === "head") console.log(words.some(w => w.startsWith("/proc/")) ? group : (await Bun.stdin.text()).trim().split("\n").slice(0, 3).join("\n"));
  else if (name === "systemctl") console.log(state.failed ? "garden-cache.service loaded failed failed Cache" : "");
  else if (name === "docker") console.log(`${id} kiln-tempo`);
  else throw new Error(`unknown fake command: ${name}`);
  process.exit(0);
}
const at = args.indexOf("--");
const machine = mode === "local" ? "garden" : args[at + 1]!;
const command = mode === "local" ? await Bun.stdin.text() : args[at + 2]!;
if (mode === "local") {
  const p = Bun.spawn(["/bin/sh"], { stdin: new Blob([command]), stdout: "inherit", stderr: "inherit", env: { ...process.env } });
  process.exit(await p.exited);
}
if (machine === "notebook" && state.asleep) process.exit(255);
if (/^(docker restart|systemctl --user restart)/.test(command.trim())) {
  await restart(machine, command.trim());
  process.exit(0);
}
if (state.sampleDelay) {
  writeFileSync(`${file}.sampling`, machine);
  await Bun.sleep(state.sampleDelay);
}
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
