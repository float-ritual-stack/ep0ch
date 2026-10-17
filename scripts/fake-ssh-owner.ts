// A detached fake forward must still belong to the test runner, even when SIGKILL bypasses its teardown.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "fake-ssh-owner-"));
const file = join(dir, "pid");
writeFileSync(file, String(process.pid));
process.env.FAKE_SSH_OWNER_FILE = file;
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
