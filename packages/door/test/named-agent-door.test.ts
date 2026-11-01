import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ScratchHost, until } from "./scratch";
import { ScratchCore } from "./scratch-hc";

test("the drawer keeps explicit picks and follows changed declarations after reopening", async () => {
  const core = new ScratchCore(), host = new ScratchHost();
  const main = resolve(import.meta.dir, "../src/main.ts"), control = join(core.dir, "door.sock");
  await host.start();
  await host.create("garden");
  const env = { ...core.env, EP0CH_CONTROL: control, EP0CH_OUTLINES: host.outlines, EP0CH_SOCKET: host.sock };
  const cli = async (...args: string[]) => {
    const r = await core.run([process.execPath, main, ...args], env);
    if (r.code !== 0) throw new Error(`${args.join(" ")}: ${r.err}`);
    return JSON.parse(r.out);
  };
  let door: ReturnType<typeof Bun.spawn> | null = null;
  const close = async () => {
    if (!door) return;
    // Leave terminal input, then use the door's normal quit keys (a named program stays in hc).
    if ((await cli("peek", "--json")).drawer.entered) door.terminal!.write("\x1d");
    door.terminal!.write("\x1b");
    await Bun.sleep(50);
    door.terminal!.write("\x03");
    await Bun.sleep(50);
    door.terminal!.write("\x03");
    await until(() => door!.exitCode !== null, "the scratch door to quit", 10_000);
    door.terminal!.close();
    door = null;
  };
  const open = async () => {
    door = Bun.spawn([process.execPath, main, "--ws", "garden", "--screen", "desk", "--no-daemon"], {
      cwd: core.dir, env, terminal: { cols: 140, rows: 40, data() {} },
    });
    await until(() => existsSync(control), "the scratch door's control socket", 15_000);
    await cli("act", "host.toggle", "open=true", "--as", "garden-tester");
  };
  try {
    await open();
    expect((await cli("peek", "--json")).drawer.namedAgent.persona).toBe("fern");
    const picked = await cli("act", "host.agent", "name=shell", "--as", "garden-tester");
    if (picked.runs[0] === "/bin/sh") await cli("act", "tile.type", `tile=${picked.name}`, "text=exit\\n", "--as", "garden-tester");
    await close();

    const updated = join(core.dir, "fern-new.sh");
    writeFileSync(updated, readFileSync(join(core.dir, "fern.sh"), "utf8").replace("Fern ready", "Fern grew"));
    const row = `[[agent]]\npersona = "fern"\nfolder = ${JSON.stringify(join(core.dir, "plot"))}\nprogram = ${JSON.stringify(`/bin/sh ${updated}`)}\n`;
    writeFileSync(join(core.dir, ".ep0ch/agents.toml"), row);
    await open();
    await cli("act", "named.start", "tile=fern", "--as", "garden-tester");
    await core.hc("wait", "fern", "--timeout", "5");
    const terminal = JSON.parse((await core.hc("get", "fern")).out);
    const text = (await core.hc("read", "fern")).out;
    await close();

    writeFileSync(join(core.dir, ".ep0ch/config.toml"), 'ws = "garden"\nagent = "moss"\n');
    writeFileSync(join(core.dir, ".ep0ch/agents.toml"), row + row.replace('persona = "fern"', 'persona = "moss"'));
    await open();
    const reopened = await cli("peek", "--json");
    expect({ picked: picked.runs[0], folder: terminal.cwd, updatedProgram: text.includes("Fern grew"), persona: reopened.drawer.namedAgent?.persona }).toEqual({
      picked: "/bin/sh", folder: join(core.dir, "plot"), updatedProgram: true, persona: "moss",
    });
  } finally {
    try { await close(); }
    finally { await core.dispose(); await host.dispose(); }
  }
}, 60_000);
