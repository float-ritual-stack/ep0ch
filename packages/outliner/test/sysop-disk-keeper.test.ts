// The sysop monk's disk trip where the disk keeper runs (PIE-1787): the keeper decides the disk, so Calm runs it now.
import { expect, test } from "bun:test";
import { crossings, parseReading, SAFE_COMMAND } from "../extensions/sysop/sample";

const output = (keeper: boolean) => [
  "@@mem", "               total        used        free      shared  buff/cache   available", "Mem:     8000000000  1000000000  5000000000           0  2000000000  6000000000",
  "@@load", "0.5 0.4 0.3 1/40 999", "@@cpus", "4",
  "@@disk", "Filesystem 1B-blocks Used Available Capacity Mounted on", "/dev/sda1 40000000000 38000000000 2000000000 95% /",
  "@@failed", "@@keeper", ...(keeper ? ["yes"] : []), "@@top", "@@end",
].join("\n");
const t = { diskFreeMin: { share: 0.1 } };

test("a disk trip where the keeper runs: its command runs the keeper, and Calm may run it", () => {
  const [disk] = crossings(parseReading(output(true)), t);
  expect(disk).toMatchObject({ kind: "disk", command: "systemctl --user restart ep0ch-disk.service" });
  expect(SAFE_COMMAND.test(disk!.command!)).toBe(true);
});

test("without the keeper, a disk trip has nothing safe to run", () => {
  const [disk] = crossings(parseReading(output(false)), t);
  expect(disk!.kind).toBe("disk");
  expect(disk!.command).toBeUndefined();
});
