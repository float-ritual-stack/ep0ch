// A ::links block whose query the service refuses shows the whole refusal in its frame (PIE-729), not one cut row.
import { afterEach, expect, test } from "bun:test";
import { renderLinkBlock, setLinksSource } from "../src/links";

const refusal = 'Invalid property filter key: type! at character 1. Did you mean NOT type=letter? There is no != ; put NOT before the clause. Example: type=thread and (status=open or status=blocked)';
const frame = (title: string, body: string[], _W: number, footer?: string) => [`[${title}]`, ...body, footer ?? ""];
const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
afterEach(() => setLinksSource(null, () => {}));

test("a refused query is named, wrapped whole and carries the fix", async () => {
  // The matches are a watched blocks.query (src/watched.ts): the service refuses it.
  setLinksSource({ request: () => Promise.reject(new Error(refusal)) } as any, () => {});
  const spec = { kind: "links", of: null, filter: "", title: "Not letters", groups: null, query: "type!=letter", preview: "right" } as const;
  const draw = () => renderLinkBlock({ ...spec }, undefined, 40, frame).map(strip);
  draw();
  await Bun.sleep(20);
  const rows = draw();
  expect(rows[1]).toBe("query: type!=letter");
  const said = rows.slice(2).join(" ");
  expect(said).toContain("Invalid property filter key: type!");
  expect(said).toContain("Did you mean NOT type=letter?");
  expect(said).toContain("Example: type=thread");
  expect(rows.length).toBeGreaterThan(5);
  expect(rows.slice(1, -1).every(r => r.length <= 36)).toBe(true);
  expect(rows.at(-1)).toBe("live · query not read");
});
