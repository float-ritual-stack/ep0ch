// A test file run from the repository's root (`bun test packages/door/test/edit.test.ts`, as `scripts/agent-env`
// runs it) gets its package's preload, as it does run from the package: Bun reads only the bunfig.toml of the folder
// it starts in. Without it, a door test writes the person's door state and keeps their EP0CH_* settings, and an
// outliner test reads the owner's extensions folder. A preload can't see which files a run has, so every package's
// runs: each only keeps a test from the person's own settings and state, and a run of several packages' files is kept
// from them all.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const packages = join(import.meta.dir, "..", "packages");
for (const pkg of readdirSync(packages).sort()) {
  const preload = join(packages, pkg, "test", "preload.ts");
  if (existsSync(preload)) await import(preload);
}
