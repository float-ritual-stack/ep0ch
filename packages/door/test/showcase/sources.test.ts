// The sources section (PIE-1340): a comment ending in [[seed has its list open, the outline's pages and the Issues
// extension's rows ranked together by one matcher; Detail's completer (the outliner's shared session) shows the same
// rows from the same service; Issues uninstalled the way a person does (the power bar's & row, and act) takes its rows
// away and installed again brings them back. Scratch service, made-up notes and issues.
import { describe, expect, test } from "bun:test";
import { completionOf, lineCompleter } from "../../src/surface/completer";
import { extensionList } from "../../src/extensions";
import { USER } from "../../src/socket";
// Detail's own modules, loaded as Detail runs them (their own package checks their types, under its own settings).
const detailModule = (file: string) => import(`../../../outliner/src/${file}`) as Promise<any>;
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: completion sources (PIE-1340)", () => {
  const h = useShowcaseScreen(160);
  const { S } = h;
  const stage = () => S().stages.get(S().sel).top;
  const d = () => stage().pane("guide").surface.session?.composer;
  const pop = () => (d() ? completionOf(d()) : null);
  const settled = async (what: string, ok: () => boolean = () => true) => { await until(() => !!pop() && !pop()!.loading && pop()!.items.length > 0 && ok(), what, 10_000); return pop()!; };
  const agent = { kind: "agent" as const, id: "test-agent" };

  test("the bar's line completes references, components and callouts without consuming their scope prefixes", async () => {
    await h.app.dispatch.press("bar.open", { scope: "all", query: "" });
    for (const ch of "[[seed") h.ch(ch);
    const completion = () => h.app.bar && lineCompleter(h.app.bar.input)?.shown;
    await until(() => !!completion()?.items.some(i => i.kind === "issue"), "references on the bar's line", 8000);
    const picked = completion()!.items[completion()!.index]!;
    expect(picked.kind).toBe("page");
    const drawn = h.app.bar!.draw(160, 60).lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, "")).join("\n");
    expect(drawn).toContain("issue");
    h.press({ kind: "tab" });
    await until(() => h.app.bar?.query === picked.insertion, "the page inserted into the bar's line");
    await h.app.dispatch.press("bar.close");
    for (const [text, kind] of [["::graph-stat", "component"], ["> [!ti", "callout"]]) {
      await h.app.dispatch.press("bar.open", { scope: "all", query: "" });
      for (const ch of text!) h.ch(ch);
      expect(h.app.bar!.query).toBe(text!);
      await until(() => !!completion()?.items.some(i => i.kind === kind), `${kind} on the bar's line`, 8000);
      await h.app.dispatch.press("bar.close");
    }
  }, 20_000);

  test("an extension's issues rank with the pages under [[, Detail shows the same rows, and uninstalling takes them away", async () => {
    await h.app.dispatch.press("section", { name: "sources" });
    await until(() => marks.sources!.every(m => h.screen().includes(m)), "the sources section", 10_000);
    let p = await settled("the [[ popup", () => pop()!.items.some(i => i.kind === "issue"));
    const kinds = p.items.map(i => i.kind);
    // The pages whose titles start with the word, then the issue that only holds it: one list, one order.
    expect(p.items[0]!.kind).toBe("page");
    const issue = p.items.findIndex(i => i.insertion === "[issue::#15]");
    expect(issue).toBeGreaterThan(p.items.findIndex(i => i.insertion === "[[Seed swap day]]"));
    expect(kinds).toContain("page");
    expect(p.items[issue]!.docs).toContain("spring seed swap");
    expect(h.screen()).toMatch(/#15 Seed swap sign-up sheet.*issue/);

    // Detail asks the same service the same way (the outliner's shared completion session), from the same note: the
    // same rows, in order.
    const [{ ReferenceCompletionSession, referenceCompletionProvider }, { TextBuffer }, { OutlinerClient }] = await Promise.all(
      ["reference-completion.ts", "text-buffer.ts", "client.ts"].map(detailModule));
    const client = new OutlinerClient(h.scratch.sock);
    const buffer = new TextBuffer("Which issue is the swap, see [[seed"); buffer.moveEnd();
    const detail = new ReferenceCompletionSession(referenceCompletionProvider(client, "detail"), () => buffer, () => {}, () => true, () => ({ blockId: h.seeded.notes.sources.id, text: buffer.text }));
    await detail.refresh();
    expect(detail.state!.items.map((i: { insertion: string }) => i.insertion)).toEqual(p.items.map(i => i.insertion));
    expect(detail.state!.items.find((i: { insertion: string }) => i.insertion === "[issue::#15]")).toMatchObject({ kind: "issue", detail: "feature" });

    // Inserted by act, as tab or ⏎ would: the issue's property, one undo step.
    await stage().dispatch.act({ action: "complete.accept", args: { n: issue + 1 }, tile: "guide" }, USER);
    await until(() => d()!.text.endsWith("[issue::#15]"), "the issue inserted", 8000);

    // Uninstalled through act, as the power bar's &issues row does: its rows go, the pages stay.
    await h.app.dispatch.act({ action: "extensions.uninstall", args: { id: "issues", demo: "keep" } }, USER);
    await h.app.loadExtensions(true);
    await until(() => !extensionList()?.extensions.some(e => e.id === "issues"), "issues removed");
    const listed = await h.app.dispatch.act({ action: "bar.open", args: { scope: "&", query: "issues" } }, agent) as { rows: { label: string }[] };
    expect(listed.rows.some(r => r.label === "install Issues")).toBe(true);
    const gone = await h.app.act({ action: "complete", args: { text: "[[seed" }, as: "test-agent" }) as { items: { kind?: string; insertion: string }[] };
    expect(gone.items.some(i => i.kind === "issue")).toBe(false);
    expect(gone.items.some(i => i.insertion === "[[Seed swap day]]")).toBe(true);

    // The visible install row goes through the same action as act.
    await h.app.dispatch.press("bar.open", { scope: "&", query: "issues" });
    await h.app.bar!.settled();
    const painted = h.app.bar!.draw(160, 60);
    const lines = painted.lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, ""));
    const y = lines.findIndex(l => l.includes("install Issues"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = painted.rect.col + lines[y]!.indexOf("install Issues") + 2;
    h.press({ kind: "mouse", action: "down", button: 0, x, y: painted.rect.row + y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y: painted.rect.row + y });
    h.press({ kind: "mouse", action: "down", button: 0, x, y: painted.rect.row + y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y: painted.rect.row + y });
    await until(() => !!extensionList()?.extensions.some(e => e.id === "issues"), "Issues installed by double click");
    if (h.app.bar) h.press({ kind: "esc" });
    await h.app.dispatch.act({ action: "extensions.uninstall", args: { id: "issues", demo: "keep" } }, USER);
    // Installing again through act returns the same rows.
    const installed = await h.app.dispatch.act({ action: "extensions.install", args: { id: "issues" } }, agent) as { state?: string };
    expect(installed.state).toBe("active");
    await h.app.loadExtensions(true);
    const back = await h.app.act({ action: "complete", args: { text: "[issue::2" }, as: "test-agent" }) as { items: { insertion: string }[] };
    expect(back.items.map(i => i.insertion)).toEqual(["#21", "#27"]);
    await stage().dispatch.act({ action: "comment.write", args: { body: "[issue::" }, tile: "guide" }, USER);
    await stage().dispatch.act({ action: "complete.ask", tile: "guide" }, USER);
    const chosen = pop()!.items.findIndex(i => i.insertion === "#27");
    await stage().dispatch.act({ action: "complete.accept", args: { n: chosen + 1 }, tile: "guide" }, USER);
    await stage().dispatch.act({ action: "comment.write", args: { body: "[issue::" }, tile: "guide" }, USER);
    await stage().dispatch.act({ action: "complete.ask", tile: "guide" }, USER);
    expect(pop()!.items[0]!.insertion).toBe("#27");
    buffer.replaceText("[issue::"); buffer.moveEnd(); await detail.refresh();
    expect(detail.state!.items[0]!.insertion).toBe("#27");
    detail.dismiss();
    p = pop() ?? p;
    for (let i = 0; i < 4 && S().focus === "stage"; i++) h.press({ kind: "esc" });
  }, 60_000);

  test("a query being typed completes the grammar: atoms, this, NOT, relative dates, and each row says what it means (PIE-1472)", async () => {
    const ask = async (text: string) => await h.app.act({ action: "complete", args: { text }, as: "test-agent" }) as { items: { insertion: string; label: string; detail?: string }[] };
    const atoms = await ask("[query::");
    expect(atoms.items.map(i => i.insertion)).toEqual(expect.arrayContaining(["under:", "parent:", "links:", "child:", "#", "NOT"]));
    // The words come from the grammar's own table, not from the completer.
    expect(atoms.items.find(i => i.insertion === "under:")!.detail).toBe("the target and everything under it");
    expect((await ask("[query::type=meeting AND under:t")).items.map(i => i.insertion)).toContain("type=meeting AND under:this]");
    expect((await ask("[query::updated >= -")).items.map(i => i.insertion)).toContain("updated >= -7d]");
    expect((await ask("[query::owner={{")).items.map(i => i.insertion)).toContain("owner={{this.owner}}]");
  }, 60_000);

  test("a lens:: line typed in a note completes its script's slots and its query's grammar (PIE-1472)", async () => {
    await h.app.dispatch.act({ action: "extensions.install", args: { id: "lens" } }, agent);
    await h.app.loadExtensions(true);
    const ask = async (text: string) => await h.app.act({ action: "complete", args: { text }, as: "test-agent" }) as { kind: string; items: { insertion: string; label: string; docs?: string }[] };
    const slots = await ask("lens:: ");
    expect(slots.kind).toBe("attribute");
    expect(slots.items.map(i => i.label)).toEqual(expect.arrayContaining(["query", "columns", "sort", "dir"]));
    expect(slots.items.find(i => i.label === "query")!.docs).toContain("grammar");
    const query = await ask('lens:: query="type=meeting AND un');
    expect(query.kind).toBe("attribute-value");
    expect(query.items.map(i => i.label)).toEqual(expect.arrayContaining(["type=meeting AND under:", "type=meeting AND unread:"]));
    await h.app.dispatch.act({ action: "extensions.uninstall", args: { id: "lens", demo: "keep" } }, agent);
  }, 60_000);
});
