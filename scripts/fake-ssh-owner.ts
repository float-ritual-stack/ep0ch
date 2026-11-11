// A detached fake forward must still belong to the test runner, even when SIGKILL bypasses its teardown.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ownedTempDir } from "./scratch-dir";

// Owned as a scratch dir is (PIE-1742): a plain `bun` program removes it as it exits, and `bun test` (1.4), which never
// fires `exit`, leaves it for the next run to take once this process is gone.
const dir = ownedTempDir("fake-ssh-owner-");
const file = join(dir, "pid");
writeFileSync(file, String(process.pid));
process.env.FAKE_SSH_OWNER_FILE = file;
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
