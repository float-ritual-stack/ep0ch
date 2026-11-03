// Cleanups a shared test helper registers (script-harness.ts), run after every test by the preload's afterEach
// (test/preload.ts). A helper module's own top-level afterEach would attach only to the first test file that imports
// it: in one `bun test` process every later file's services kept running and its env stayed set (PIE-1553, where
// keep.test.ts's user folder, Keep installed, leaked into protocol.test.ts's service).
export const testCleanups: Array<() => Promise<void> | void> = [];

export async function runTestCleanups(): Promise<void> {
  for (const cleanup of testCleanups.splice(0).reverse()) await cleanup();
}
