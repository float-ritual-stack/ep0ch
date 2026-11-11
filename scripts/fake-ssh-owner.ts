// A detached fake forward must still belong to the test runner, even when SIGKILL bypasses its teardown.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "fake-ssh-owner-"));
const file = join(dir, "pid");
writeFileSync(file, String(process.pid));
process.env.FAKE_SSH_OWNER_FILE = file;
/**
 * The owner's folder, gone. A plain `bun` program that imports this file removes it as it exits; `bun test` (1.4) never
 * fires `exit`, so a test preload calls this from its `afterAll` (PIE-1742: every test process left one in /tmp, 172,000 by
 * Nov 11, and each extension process bun starts under /tmp read the folder whole).
 */
export const removeFakeSshOwner = () => rmSync(dir, { recursive: true, force: true });
process.on("exit", removeFakeSshOwner);
