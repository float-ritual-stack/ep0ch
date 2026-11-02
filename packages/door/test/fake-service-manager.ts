// A fake systemctl and launchctl for tests that run `ep0ch install --apply` in a scratch home: since #1157 install
// also installs and starts a missing local host (src/setup/host.ts), so it runs the service manager, and the real one
// is this machine's (Nov 2: setup tests talked to the real user systemd, or failed where there was no user bus).
// Each wrapper logs its call, then hands it to test/fake-host-manager.ts, which runs the unit install wrote against a
// real scratch host (so the host step's wait sees it answer). The test's repo needs packages/outliner/src/host-main.ts
// (a symlink of the real src is enough), and the test stops the host it started with stopUnder (test/scratch.ts).
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A folder holding the fakes, to put first on the test's PATH; `log` lists each call as one line of its words. */
export function fakeServiceManager(dir: string): { bin: string; log: string } {
  const bin = join(dir, "fake-service-bin"), log = join(dir, "service-calls.log");
  mkdirSync(bin, { recursive: true });
  for (const name of ["systemctl", "launchctl"]) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\nexec '${process.execPath}' '${join(import.meta.dir, "fake-host-manager.ts")}' ${name} "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return { bin, log };
}
