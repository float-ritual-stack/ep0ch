// The tables are the door's answers at its defaults, the same from any shell. A test run has that already (test/preload.ts:
// none of the person's EP0CH_* settings, a state folder of its own); by hand, the script runs under scripts/agent-env,
// which gives the same. Imported first, before any module of the door reads a setting.
if (process.env.NODE_ENV !== "test" && !process.env.EP0CH_STATE) {
  console.error("run it as: scripts/agent-env <your name> -- bun packages/door/scripts/layout-contract.ts\n(the tables are made at the door's defaults: a theme, a keymap or a now page of your own would be written into them)");
  process.exit(2);
}
// What a spec reads from the shell as it's made (the pinned page's name): its default.
for (const k of ["EP0CH_NOW_PAGE", "EP0CH_NOW_LABEL", "EP0CH_THEME", "EP0CH_KEYMAP"]) delete process.env[k];
