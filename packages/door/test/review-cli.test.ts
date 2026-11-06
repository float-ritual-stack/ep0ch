// `ep0ch review`: each subcommand refuses a flag only the other one uses, rather than taking it and doing nothing. Refused
// before any outline is reached, so no host is needed.
import { expect, test } from "bun:test";
import { reviewCommand } from "../src/review-cli";

const run = async (...args: string[]) => {
  const said: string[] = [];
  const code = await reviewCommand(["review", ...args], { out: s => { said.push(s); }, err: s => { said.push(s); } });
  return { code, said: said.join("\n") };
};

for (const flags of [["--into", "garden"], ["--into-machine", "shed"], ["--json"], ["--no-jev"]]) {
  test(`review asks refuses ${flags[0]}`, async () => {
    const { code, said } = await run("asks", ...flags);
    expect(code).toBe(2);
    expect(said).toContain(`ep0ch review asks: ${flags[0]} isn't a flag it takes`);
  });
}

test("review backfill refuses --write", async () => {
  const { code, said } = await run("backfill", "--write");
  expect(code).toBe(2);
  expect(said).toContain("ep0ch review backfill: --write isn't a flag it takes");
});
