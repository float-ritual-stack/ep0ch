// A fake systemctl and launchctl for tests that run `ep0ch install --apply` in a scratch home: since install also
// installs a missing local host (src/setup/host.ts), it runs the service manager, and the real one is this machine's
// (Nov 2: setup tests talked to the real user systemd, or failed where there was no user bus). Each call is logged.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A folder holding the fakes, to put first on the test's PATH; `log` lists each call as one line of its words. */
export function fakeServiceManager(dir: string): { bin: string; log: string } {
  const bin = join(dir, "fake-service-bin"), log = join(dir, "service-calls.log");
  mkdirSync(bin, { recursive: true });
  for (const name of ["systemctl", "launchctl"]) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\nexit 0\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return { bin, log };
}
