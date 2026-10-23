// PIE-439: the showcase screen, extensions, pages, forms, rules and settings. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { openScreen } from "../../src/desk/screen-specs";
import { Desk } from "../../src/desk/desk";
import { ReaderPane } from "../../src/desk/panes";
import { App } from "../../src/app";
import { type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { USER, SocketBoard } from "../../src/socket";
import { extensionNamed } from "../../src/extensions";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: extensions, pages, forms, rules and settings", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("extensions as programs (PIE-754): almanac's schedule is listed; its action, through act with no block, writes a dated note under the Almanac page as ext:almanac, once a day", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "extensions" }, as: "test-agent" })).toMatchObject({ key: "extensions" });
    await until(() => screen().includes("schedule action:write-day") && screen().includes("cron 5 6 * * *"), "almanac's schedule listed", 8000)
      .catch(e => { throw new Error(`${e.message}\n${screen()}`); });
    expect(screen()).toContain("not run yet");
    const page = seeded.notes.almanac.id;
    expect(await board.children(page)).toEqual([]);
    const done = await app.act({ action: "ext.almanac.write-day", as: "test-agent" }) as { message?: string };
    expect(done.message).toStartWith("wrote Almanac for ");
    const [note] = await board.children(page);
    expect(note!.text).toMatch(/^Almanac for \d{4}-\d\d-\d\d \[type::almanac\] \[date::\d{4}-\d\d-\d\d\]/);
    expect(String(note!.author)).toContain("ext:almanac");
    // Again the same day: it says the note is there, and writes nothing.
    expect((await app.act({ action: "ext.almanac.write-day", as: "test-agent" }) as { message?: string }).message).toEndWith("is already there");
    expect(await board.children(page)).toHaveLength(1);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  test("extension pages: the Extensions hub and the notifications hub's page with its demo boards, live; one installed and removed through act and the power bar's extensions scope", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "ext-pages" }, as: "test-agent" })).toMatchObject({ key: "ext-pages" });
    await until(() => screen().includes("## Installed") && screen().includes("Notifications hub") && screen().includes("A deterministic fetcher"), "the hub and notify's page", 10_000)
      .catch(e => { throw new Error(`${e.message}\n${screen()}`); });
    const listed = await board.listExtensions(true);
    const title = (m: { text: string }) => m.text.split("\n")[0];
    // The page's demo notes, written once as the extension; its boards are views over what the pull wrote.
    const demo = await board.children(listed.pages!.notify!);
    expect(demo.map(title)).toEqual(["Start here: your notifications on two boards", "Notifications by read state [page::notifications-state]", "Notifications by source [page::notifications-source]"]);
    expect(String(demo[0]!.author)).toContain("ext:notify");
    const [unread] = await board.children(demo[1]!.id);
    expect((await board.readSavedView(unread!.id))?.blocks.length).toBeGreaterThan(0);
    const [runbook] = await board.children(listed.pages!.runbook!);
    expect(title(runbook!)).toBe("Ship the demo widget [type::runbook] [env::scratch]");
    // The hub lists what's installed, and what the repo has that isn't; the bar's extensions scope offers it.
    const hubText = (await board.get(listed.hub!))!.text;
    expect(hubText).toContain(`((${listed.pages!.notify}|Notifications hub))`);
    expect(listed.available!.map(a => a.id)).toContain("horoscope");
    const rows = await app.act({ action: "bar.open", args: { scope: "&", query: "horoscope" }, as: "test-agent" }) as { rows: { label: string }[] };
    expect(rows.rows.map(r => r.label)).toContain("install Horoscope");
    // Installed by act: its page is written before the answer; removed again, the demo's fate said.
    const done = await app.act({ action: "extensions.install", args: { id: "horoscope" }, as: "test-agent" }) as { page?: string };
    expect(title((await board.get(done.page!))!)).toBe("Horoscope [ext.page::horoscope] [page::ext-horoscope]");
    await until(() => !!extensionNamed("horoscope"), "the door bound horoscope", 5000);
    await expect(app.act({ action: "extensions.uninstall", args: { id: "horoscope" }, as: "test-agent" })).rejects.toThrow(/demo/);
    await app.act({ action: "extensions.uninstall", args: { id: "horoscope", demo: "keep" }, as: "test-agent" });
    expect((await board.listExtensions(true)).pages?.horoscope).toBeUndefined();
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("structure (PIE-784): sort-blocks run by the person asks by= and order= in the power bar, chosen by keys, and lands as one order; an agent's extract is one step it undoes whole", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "ext-pages" }, as: "test-agent" })).toMatchObject({ key: "ext-pages" });
    const listed = await board.listExtensions(true);
    const title = (m: { text: string }) => m.text.split("\n")[0]!;
    const demo = await board.children(listed.pages!.structure!);
    const beds = demo.find(m => title(m).startsWith("Beds"))!, plan = demo.find(m => title(m) === "Garden plan")!;
    const names = async () => (await board.children(beds.id)).map(m => title(m).split(" [")[0]);
    expect(await names()).toEqual(["Herb bed", "Root bed", "Bean row"]);
    // The person's run: the bar asks, lit on the note's own [sort-by::bed-size]; "tit" then ⏎ picks title, ⏎ takes asc.
    // The actions scope finds it by what it does, not only by its name.
    const found = await app.act({ action: "bar.open", args: { scope: ">", query: "sort the children" }, as: "test-agent" }) as { rows: { label: string }[] };
    expect(found.rows.map(r => r.label)).toContain("ext.structure.sort-blocks");
    // The bar is the App's, over the showcase: what it lists is read from it.
    const asked = () => { const b = app.bar; return b && !b.ended() && b.scope === "ask" ? b.items.map(i => `${i.row.group} = ${i.row.label}`) : []; };
    void app.dispatch.press("ext.structure.sort-blocks", { block: beds.id });
    await until(() => asked()[0] === "Sort the children · Sort by = bed-size", "the bar asks for by, the note's own lit", 8000)
      .catch(e => { throw new Error(`${e.message}\n${JSON.stringify(asked())}`); });
    expect(asked()).toEqual(["bed-size", "title", "created"].map(c => `Sort the children · Sort by = ${c}`));
    for (const c of "tit") ch(c);
    press({ kind: "enter" });
    await until(() => asked()[0]?.startsWith("Sort the children · Order") ?? false, "the bar asks for order", 8000)
      .catch(e => { throw new Error(`${e.message}\n${JSON.stringify(asked())}`); });
    press({ kind: "enter" });
    for (let i = 0; i < 80 && (await names()).join() !== "Bean row,Herb bed,Root bed"; i++) await Bun.sleep(100);
    expect(await names()).toEqual(["Bean row", "Herb bed", "Root bed"]);
    // An agent names what it wants and is never asked; the note's own default fills in what it leaves out.
    await app.act({ action: "ext.structure.sort-blocks", args: { block: beds.id }, as: "test-agent" });
    expect(await names()).toEqual(["Herb bed", "Bean row", "Root bed"]);
    // Extract: the child and the note's edit are one group, and one undo puts both back.
    const quote = "The north fence needs mending before the beans go in";
    const done = await app.act({ action: "ext.structure.extract", args: { block: plan.id, quote }, as: "test-agent" }) as { undo?: string; written: string[] };
    const [child] = await board.children(plan.id);
    expect(child!.text).toBe(quote);
    expect((await board.get(plan.id))!.text).toContain(`!((${child!.id}))`);
    await board.undoExtension(done.undo!, { kind: "agent", id: "test-agent" });
    expect((await board.get(plan.id))!.text).toBe(plan.text);
    expect(await board.children(plan.id)).toEqual([]);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("forms draw and submit in place by clicks and act (PIE-1212)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "forms" }, as: "test-agent" });
    await until(() => screen().includes("book *"), "the reading log's labelled form", 3000);
    expect(screen()).not.toContain("[form-field::");
    expect(screen()).toContain("(*) slow");
    const click = (text: string, offset = 1) => {
      const rows = screen().split("\n"), right = rows.find(row => row.includes("2 Shed repairs"))!.indexOf("2 Shed repairs");
      const y = rows.findIndex(row => row.includes(text) && row.indexOf(text) < right);
      expect(y).toBeGreaterThanOrEqual(0);
      const x = rows[y]!.indexOf(text) + offset;
      press({ kind: "mouse", action: "down", button: 0, x, y });
      press({ kind: "mouse", action: "up", button: 0, x, y });
    };
    press({ kind: "enter" });
    click("│ pages", 15);
    press({ kind: "paste", text: "272" });
    press({ kind: "enter" });
    await until(() => screen().includes("book is required"), "required warning in the form").catch(e => { throw new Error(`${e.message}\n${screen()}`); });
    expect(screen()).toContain("272");
    click("│ book *", 15);
    press({ kind: "paste", text: "Piranesi extra" });
    expect(screen()).not.toContain("book is required");
    const rows = screen().split("\n"), y = rows.findIndex(row => row.includes("Piranesi extra")), x = rows[y]!.indexOf("Piranesi extra");
    press({ kind: "mouse", action: "down", button: 0, x: x + 8, y });
    press({ kind: "mouse", action: "drag", button: 0, x: x + 14, y });
    press({ kind: "mouse", action: "up", button: 0, x: x + 14, y });
    press({ kind: "delete" });
    expect(screen()).not.toContain("Piranesi extra");
    press({ kind: "char", ch: "z", ctrl: true });
    expect(screen()).toContain("Piranesi extra");
    press({ kind: "char", ch: "y", ctrl: true });
    press({ kind: "home" });
    press({ kind: "mouse", action: "down", button: 0, mods: 4, x: x + 8, y });
    press({ kind: "mouse", action: "up", button: 0, mods: 4, x: x + 8, y });
    press({ kind: "paste", text: "Piranesi" });
    press({ kind: "tab" });
    press({ kind: "backtab" });
    expect(screen()).toContain("Piranesi");
    press({ kind: "tab" });
    press({ kind: "tab" });
    press({ kind: "left" });
    expect(screen()).toContain("(*) gripping");
    click("( ) slow");
    await until(() => screen().includes("(*) slow"), "clicked slow radio");
    click("( ) gripping");
    await until(() => screen().includes("(*) gripping"), "clicked gripping radio");
    click("Fill in the form │");
    const reading = seeded.notes.formReading.id;
    await untilAsync(async () => (await board.children(reading)).some(m => m.text === "Piranesi [book::Piranesi] [pages::272] [mood::gripping]"), "the clicked form's child").catch(async e => { throw new Error(`${e.message}\n${JSON.stringify(await board.children(reading))}\n${screen()}`); });
    await app.act({ action: "form.set", tile: "reader", args: { field: "book", value: "The Dispossessed" }, as: "user" });
    await app.act({ action: "form.set", tile: "reader", args: { field: "pages", value: "341" }, as: "user" });
    await app.act({ action: "form.submit", tile: "reader", as: "user" });
    expect((await board.children(reading)).map(m => m.text)).toContain("The Dispossessed [book::The Dispossessed] [pages::341] [mood::slow]");
    expect(screen()).toContain("Piranesi");
    press({ kind: "esc" });
    await app.dispatch.act({ action: "edit", tile: "reader" }, USER);
    expect(screen()).toContain("[form-field::book text required]");
    await app.dispatch.act({ action: "edit.close", tile: "reader" }, USER);
    expect((await board.get(reading))!.text).toContain("[form-field::book text required]");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("the form draws and submits from a river column (PIE-1212)", async () => {
    const river = openScreen("river") as Desk;
    app.push(river);
    try {
      const opened = await river.dispatch.act({ action: "open", args: { id: seeded.notes.formReading.id } }, USER) as { name: string };
      await river.dispatch.act({ action: "tile.focus", tile: opened.name }, USER);
      const drawn = () => river.render(app).lines.map(plain).join("\n");
      await until(() => drawn().includes("book *"), "the form in the river's compact reader", 3000);
      await river.dispatch.act({ action: "form.focus", tile: opened.name, args: { field: "book" } }, USER);
      press({ kind: "paste", text: "The Left Hand of Darkness" });
      press({ kind: "tab" });
      press({ kind: "paste", text: "304" });
      press({ kind: "enter" });
      await untilAsync(async () => (await board.children(seeded.notes.formReading.id)).some(m => m.text === "The Left Hand of Darkness [book::The Left Hand of Darkness] [pages::304] [mood::slow]"), "the river form's submitted child");
      await river.dispatch.act({ action: "form.leave", tile: opened.name }, USER);
      const plainColumn = await river.dispatch.act({ action: "open", args: { id: seeded.notes.notebook.id } }, USER) as { name: string };
      await expect(river.dispatch.act({ action: "form.move", tile: plainColumn.name, args: { by: 1 } }, USER)).rejects.toThrow("form-field");
      await expect(river.dispatch.act({ action: "form.input", tile: plainColumn.name, args: { key: JSON.stringify({ kind: "paste", text: "an answer" }) } }, USER)).rejects.toThrow("form-field");
    } finally { app.pop(); }
  }, 30_000);


  test("a long form answer is edited at the text drawn in its box (PIE-1212)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "forms" }, as: "test-agent" });
    await until(() => screen().includes("book *"), "the form before its long answer");
    const answer = Array.from({ length: 80 }, (_, n) => String(n).padStart(3, "0")).join(" ");
    for (const [field, value] of [["pages", "272"], ["mood", "slow"], ["book", answer]]) {
      await app.dispatch.act({ action: "form.set", tile: "reader", args: { field, value } }, USER);
    }
    await app.dispatch.act({ action: "form.leave", tile: "reader" }, USER);
    const rows = screen().split("\n"), y = rows.findIndex(row => row.includes("│ book *"));
    const start = rows[y]!.indexOf("│", rows[y]!.indexOf("book *")) + 1;
    const shown = rows[y]!.slice(start, rows[y]!.indexOf("│", start)).trimEnd();
    const from = answer.indexOf(shown.slice(0, 8));
    expect(from).toBeGreaterThanOrEqual(0);
    const x = start + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    ch("@");
    press({ kind: "enter" });
    const expected = answer.slice(0, from + 2) + "@" + answer.slice(from + 2);
    await untilAsync(async () => (await board.children(seeded.notes.formReading.id)).some(m => m.text === `${expected} [book::${expected}] [pages::272] [mood::slow]`), "the answer edited at its visible text");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("a field named run can be filled and submitted (PIE-1212)", async () => {
    const note = await board.createBlock(null, "Trail log\n[form-field::run text required]\n[form-field::distance number]");
    const desk = new Desk({ name: "named-form", title: "Trail log", layout: { focus: "reader", root: { t: "leaf", kind: "reader", name: "reader" } } });
    app.push(desk);
    try {
      await desk.dispatch.act({ action: "open", args: { id: note.id } }, USER);
      await until(() => desk.render(app).lines.map(plain).join("\n").includes("run *"), "the form with a run field");
      await desk.dispatch.act({ action: "form.focus", tile: "reader", args: { field: "run" } }, USER);
      press({ kind: "paste", text: "Morning loop" });
      press({ kind: "tab" });
      press({ kind: "paste", text: "5" });
      press({ kind: "enter" });
      await untilAsync(async () => (await board.children(note.id)).some(m => m.text === "Morning loop [run::Morning loop] [distance::5]"), "the run field's submitted answer");
    } finally { app.pop(); }
  }, 30_000);


  for (const changed of ["Trail log", "Trail log\n[form-field::run unsupported]"]) test(`an external edit releases a vanished form and keeps its answers: ${changed} (PIE-1212)`, async () => {
    const source = "Trail log\n[form-field::run text required]\n[form-field::distance number]";
    const note = await board.createBlock(null, source);
    const other = new SocketBoard(scratch.sock);
    await other.info();
    const desk = new Desk({ name: "changed-form", title: "Trail log", layout: { focus: "reader", root: { t: "leaf", kind: "reader", name: "reader" } } });
    app.push(desk);
    const drawn = () => desk.render(app).lines.map(plain).join("\n");
    try {
      await desk.dispatch.act({ action: "open", args: { id: note.id } }, USER);
      await until(() => drawn().includes("run *"), "the original form");
      await desk.dispatch.act({ action: "form.focus", tile: "reader", args: { field: "run" } }, USER);
      press({ kind: "paste", text: "Morning loop" });
      const reader = desk.paneNamed("reader");
      if (!(reader instanceof ReaderPane)) throw new Error("the form must be in a reader");
      const surface = reader.surface;
      const before = app.messages.rows.length;
      const updated = await other.update(note.id, changed, note.revision!);
      await until(() => { drawn(); return surface.msg?.revision === updated.revision; }, "the second client's edit");
      expect(surface.claims({ kind: "tab" })).toBe(false);
      expect(surface.holdsKeys).toBe(false);
      for (let i = 0; i < 3; i++) { drawn(); surface.claims({ kind: "char", ch: "x" }); }
      expect(app.messages.rows.slice(before).filter(r => /form.*answers.*kept/i.test(r.message))).toHaveLength(1);
      ch("e");
      press({ kind: "enter" });
      await until(() => !!surface.draft, "normal reader keys open the editor without Esc");
      await desk.dispatch.act({ action: "edit.close", tile: "reader" }, USER);
      await other.update(note.id, source, updated.revision!);
      await until(() => drawn().includes("run *"), "restored fields");
      expect(drawn()).toContain("Morning loop");
    } finally { other.close(); app.pop(); }
  }, 30_000);

  test("an external field shape edit keeps surviving answers and the focused field (PIE-1212)", async () => {
    const note = await board.createBlock(null, "Trail log\n[form-field::run text required]\n[form-field::distance number]");
    const other = new SocketBoard(scratch.sock);
    await other.info();
    const desk = new Desk({ name: "reshaped-form", title: "Trail log", layout: { focus: "reader", root: { t: "leaf", kind: "reader", name: "reader" } } });
    app.push(desk);
    const drawn = () => desk.render(app).lines.map(plain).join("\n");
    try {
      await desk.dispatch.act({ action: "open", args: { id: note.id } }, USER);
      await until(() => drawn().includes("run *"), "the original form");
      await desk.dispatch.act({ action: "form.set", tile: "reader", args: { field: "distance", value: "5" } }, USER);
      await desk.dispatch.act({ action: "form.focus", tile: "reader", args: { field: "run" } }, USER);
      press({ kind: "paste", text: "Morning" });
      const updated = await other.update(note.id, "Trail log\n[form-field::weather choice sun|rain default=sun]\n[form-field::run text required]", note.revision!);
      const reader = desk.paneNamed("reader");
      if (!(reader instanceof ReaderPane)) throw new Error("the form must be in a reader");
      const surface = reader.surface;
      await until(() => { drawn(); return surface.msg?.revision === updated.revision; }, "the reshaped form");
      expect(drawn()).toContain("(*) sun");
      press({ kind: "paste", text: " loop" });
      press({ kind: "enter" });
      await untilAsync(async () => (await board.children(note.id)).some(m => m.text.includes("[run::Morning loop]") && m.text.includes("[weather::sun]") && !m.text.includes("[distance::")), "the surviving answer submitted with the new shape");
    } finally { other.close(); app.pop(); }
  }, 30_000);

  test("unfocused form answers draw as text and keep the raw answer (PIE-1212)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "forms" }, as: "test-agent" });
    await until(() => screen().includes("book *"), "the form before setting its answers");
    const value = "Piranesi\x1b]8;;https://untrusted.invalid\x07a link\x1b]8;;\x07";
    await app.dispatch.act({ action: "form.set", tile: "reader", args: { field: "book", value } }, USER);
    await app.dispatch.act({ action: "form.leave", tile: "reader" }, USER);
    expect(sc.render(app).lines.join("\n")).not.toContain("\x1b]8;;https://untrusted.invalid");
    const kept = await app.dispatch.act({ action: "form.set", tile: "reader", args: { field: "pages", value: "272" } }, USER);
    expect(kept).toMatchObject({ answers: { book: value } });
    await app.dispatch.act({ action: "form.leave", tile: "reader" }, USER);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  test("forms (PIE-828): one action, two notes, two forms; the person answers the reading log's in the power bar by keys, an agent the repairs' in with=; each writes a child with its own chips", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "forms" }, as: "test-agent" })).toMatchObject({ key: "forms" });
    await until(() => !!extensionNamed("form"), "the door bound the form extension", 8000);
    const reading = seeded.notes.formReading, repairs = seeded.notes.formRepairs;
    const kids = async (id: string) => (await board.children(id)).map(m => m.text);
    const asked = () => { const b = app.bar; return b && !b.ended() && b.scope === "ask" ? b.items.map(i => `${i.row.group} = ${i.row.label}`) : []; };
    // The person's run on the reading log: book (typed), pages (typed), then mood, its default lit first.
    void app.dispatch.press("ext.form.fill", { block: reading.id });
    await until(() => asked()[0] === "Fill in the form · book = type the book", "the bar asks for the book", 8000)
      .catch(e => { throw new Error(`${e.message}\n${JSON.stringify(asked())}`); });
    for (const c of "Moss and Lichen") ch(c);
    await until(() => asked()[0] === "Fill in the form · book = Moss and Lichen", "the typed title offered");
    press({ kind: "enter" });
    await until(() => asked()[0]?.startsWith("Fill in the form · pages") ?? false, "the bar asks for pages", 8000);
    // pages isn't needed: nothing typed offers to leave it empty.
    expect(asked()).toEqual(["Fill in the form · pages = leave it empty"]);
    for (const c of "212") ch(c);
    await until(() => asked()[0] === "Fill in the form · pages = 212", "the typed pages offered");
    press({ kind: "enter" });
    await until(() => asked()[0]?.startsWith("Fill in the form · mood") ?? false, "the bar asks for the mood", 8000);
    expect(asked()).toEqual(["slow", "gripping", "abandoned"].map(c => `Fill in the form · mood = ${c}`));
    press({ kind: "down" });
    press({ kind: "enter" });
    for (let i = 0; i < 80 && !(await kids(reading.id)).length; i++) await Bun.sleep(100);
    expect(await kids(reading.id)).toContain("Moss and Lichen [book::Moss and Lichen] [pages::212] [mood::gripping]");
    // The repairs note asks for other fields; an agent gives them at once and is never asked, its default filled in.
    await expect(app.act({ action: "ext.form.fill", args: { block: repairs.id, with: JSON.stringify({ part: "roof" }) }, as: "test-agent" })).rejects.toThrow(/needs what=.*with=/);
    await app.act({ action: "ext.form.fill", args: { block: repairs.id, with: JSON.stringify({ part: "roof", what: "a slipped tile over the bench" }) }, as: "test-agent" });
    expect(await kids(repairs.id)).toEqual(["a slipped tile over the bench [part::roof] [what::a slipped tile over the bench] [urgent::no]"]);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("structure's extract takes a line's anchor with it (PIE-829): the diary's link points at the new child, no forwarding line, one undo puts all of it back", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "ext-pages" }, as: "test-agent" })).toMatchObject({ key: "ext-pages" });
    const listed = await board.listExtensions(true);
    const title = (m: { text: string }) => m.text.split("\n")[0]!;
    const demo = await board.children(listed.pages!.structure!);
    const plan = demo.find(m => title(m) === "Garden plan")!, diary = demo.find(m => title(m) === "Garden diary")!;
    expect(diary.text).toContain(`((${plan.id}^s5|pea stakes))`);
    const line = "- Stake the peas by the north fence ^s5";
    const done = await app.act({ action: "ext.structure.extract", args: { block: plan.id, quote: line }, as: "test-agent" }) as { undo?: string; message?: string };
    expect(done.message).toBe("extracted 1 line(s) into a child, with ^s5");
    const [child] = await board.children(plan.id);
    expect(child!.text).toBe("Stake the peas by the north fence ^s5");
    const planNow = (await board.get(plan.id))!.text;
    // No forwarding line: the item is the child's embed, and ^s5 lives only in the child.
    expect(planNow).toContain(`- !((${child!.id}))`);
    expect(planNow).not.toContain("^s5");
    expect((await board.get(diary.id))!.text).toContain(`((${child!.id}^s5|pea stakes))`);
    await board.undoExtension(done.undo!, { kind: "agent", id: "test-agent" });
    expect((await board.get(plan.id))!.text).toBe(plan.text);
    expect((await board.get(diary.id))!.text).toBe(diary.text);
    expect(await board.children(plan.id)).toEqual([]);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);


  test("rules (PIE-600): a rule note's bands, meeting-card's card, shout's band; the card goes and comes with its property through act; R shows it as written; done-stamp stamps once", async () => {
    const id = seeded.notes.rules.id, text = async (of = id) => (await board.get(of))!.text;
    const at = SECTIONS.findIndex(s => s.key === "rules");
    const reader = (n = 0) => S().stages.get(at)?.top.pane(n ? "reader2" : "reader")?.describe() as any;
    const drawn = () => (reader()?.decorations?.drawn ?? []) as { rule: string; place: string; status: string; on: string; line: number }[];
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "rules" }, as: "test-agent" })).toEqual({ section: at + 1, key: "rules" });
    await until(() => screen().includes("CLOSE THE COLD FRAME TONIGHT") && screen().includes("[meeting]") && drawn().filter(d => d.status === "ready").length === 4, "the card, the bands and the shout", 12_000)
      .catch(e => { throw new Error(`${e.message}\n${screen()}\n${JSON.stringify(reader())?.slice(0, 2000)}`); });
    // The rule note's bands are in the headings' places, shout's in the line's; the card above the note.
    expect(drawn().map(d => [d.rule, d.place, d.on, d.line])).toEqual([
      ["meeting-card/card", "prepend", "block", 0], ["shout/shout", "replace", "text", 13],
      ["committee-bands", "replace", "construct", 6], ["committee-bands", "replace", "construct", 10],
    ]);
    let shown = screen();
    expect(shown).not.toContain("Close the cold frame tonight!!!");
    expect(shown).toContain("Ann, Bo, Cy");
    // Through act, as an agent: the meeting's type changed, the card goes (the text keeps everything else); back, it comes back.
    const before = await text();
    await app.act({ action: "props.edit", tile: "reader", args: { key: "type", value: "chat" }, as: "test-agent" });
    await until(() => !drawn().some(d => d.rule === "meeting-card/card") && !screen().includes("[meeting]"), "the card gone", 8000);
    expect(await text()).toBe(before.replace("[type::meeting]", "[type::chat]"));
    await app.act({ action: "props.edit", tile: "reader", args: { key: "type", value: "meeting" }, as: "test-agent" });
    await until(() => drawn().some(d => d.rule === "meeting-card/card" && d.status === "ready") && screen().includes("[meeting]"), "the card back", 10_000);
    expect(await text()).toBe(before);
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // A band is still its heading: ( ) stops on it and f folds what's under it, the band drawn over the hidden lines.
    ch(")");
    await until(() => String(reader().folds?.selected ?? "").includes("Agenda"), "( ) on the Agenda band", 5000);
    ch("f");
    await until(() => !screen().includes("Water rota for August") && screen().includes("2 lines folded"), "the Agenda band folded", 5000);
    ch("f");
    await until(() => screen().includes("Water rota for August"), "unfolded", 5000);
    // R: the note as written, and back; nothing written.
    ch("~");
    await until(() => screen().includes("Close the cold frame tonight!!!") && screen().includes("## Agenda"), "the note as written", 5000);
    expect(reader().decorations).toMatchObject({ raw: true, drawn: expect.any(Array) });
    expect(screen()).not.toContain("CLOSE THE COLD FRAME TONIGHT");
    ch("~");
    await until(() => screen().includes("CLOSE THE COLD FRAME TONIGHT"), "decorated again", 5000);
    expect(await text()).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    // done-stamp: the job's status set to done through act stamps it once, as the extension, and its own write sets nothing off.
    const job = (await board.children(id)).find(k => k.text.startsWith("Mend the water butt"))!;
    await until(() => reader(1)?.showing?.id === job.id, "the job beside", 5000);
    await app.act({ action: "props.edit", tile: "reader2", args: { key: "status", value: "done" }, as: "test-agent" });
    const has = async (re: RegExp) => { const end = Date.now() + 10_000; while (!re.test(await text(job.id))) { if (Date.now() > end) throw new Error(`timed out waiting for ${re}`); await Bun.sleep(50); } };
    await has(/\[done-at::\d{4}-\d\d-\d\d\]/);
    const stamped = (await board.get(job.id))!;
    await Bun.sleep(2500);
    expect((await board.get(job.id))!.revision).toBe(stamped.revision);
    expect((await text(job.id)).match(/done-at/g)).toHaveLength(1);
    await app.act({ action: "props.edit", tile: "reader2", args: { key: "status", value: "todo" }, as: "test-agent" });
    await has(/^(?![\s\S]*done-at)/);
  }, 60_000);


  test("settings (PIE-786): , opens a rule note's card; an agent lists its fields and sets one through act, checked by type; the person's enter asks in the power bar, its query built from this outline's own properties", async () => {
    const id = seeded.notes.settings.id, text = async () => (await board.get(id))!.text;
    const at = SECTIONS.findIndex(s => s.key === "settings");
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "settings" }, as: "test-agent" })).toEqual({ section: at + 1, key: "settings" });
    await until(() => screen().includes("Compost bay jobs get a badge") && screen().includes("Plot chat"), "the rule note and the area", 8000);
    // An agent reads the fields as tool arguments: the rule's, from its component schema, with their types.
    const listed = await app.act({ action: "settings", tile: "reader", as: "test-agent" }) as { schema: string; fields: { key: string; type: string; value: string | null }[] };
    expect(listed.schema).toBe("rule");
    expect(listed.fields[0]).toMatchObject({ key: "rule-name", value: "bay-badges" });
    expect(listed.fields.map(f => [f.key, f.type])).toEqual(expect.arrayContaining([["rule-match", "query"], ["rule-on", "action"], ["rule-from", "writers"], ["rule-batch", "duration"], ["rule-tone", "enum"]]));
    // Plot chat is a view and an EchoNet area: two sections, the view's first, each in its own schema's order.
    const both = await app.act({ action: "settings", tile: "reader2", as: "test-agent" }) as { schemas: { id: string }[]; fields: { key: string; section: string; value: string | null }[] };
    expect(both.schemas.map(s => s.id)).toEqual(["view", "echonet-area"]);
    expect(both.fields.map(f => [f.section, f.key])[0]).toEqual(["view", "query"]);
    expect(both.fields.find(f => f.key === "echo")).toMatchObject({ section: "echonet-area", value: "plot.chat" });
    // The same value again writes nothing.
    await expect(app.act({ action: "settings.set", tile: "reader2", args: { key: "echo", value: "plot.chat" }, as: "test-agent" })).resolves.toMatchObject({ unchanged: true });
    // The person's , opens the card in the reader they're in.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch(",");
    await until(() => screen().includes("settings · Rules · bay-badges") && screen().includes("rule-tone"), "the card", 5000)
      .catch(e => { throw new Error(`${e.message}\n${screen()}`); });
    // Through act, as an agent: a value its type refuses is said; one it takes is an attributed property edit.
    const before = await text();
    await expect(app.act({ action: "settings.set", tile: "reader", args: { key: "rule-tone", value: "loud" }, as: "test-agent" })).rejects.toThrow("is one of");
    await app.act({ action: "settings.set", tile: "reader", args: { key: "rule-tone", value: "good" }, as: "test-agent" });
    expect(await text()).toBe(before.replace("[rule-tone::accent]", "[rule-tone::good]"));
    await app.act({ action: "settings.set", tile: "reader", args: { key: "rule-cap", value: "20/day" }, as: "test-agent" });
    expect(await text()).toContain("[rule-cap::20/day]");
    await app.act({ action: "settings.clear", tile: "reader", args: { key: "rule-cap" }, as: "test-agent" });
    expect(await text()).not.toContain("rule-cap");
    await expect(app.act({ action: "settings.clear", tile: "reader", args: { key: "rule-name" }, as: "test-agent" })).rejects.toThrow("what makes this note");
    await until(() => screen().includes("good"), "the card shows the new tone", 5000);
    // The person's ⏎ on rule-match asks in the power bar: the query built from what this outline's notes have. The card
    // holds the reader's keys once the person is in it (⏎ enters, as the property panel's does).
    press({ kind: "enter" });
    ch("j");
    await until(() => screen().includes("rule-match · query"), "rule-match selected", 3000).catch(e => { throw new Error(`${e.message}\n${screen()}`); });
    // The bar is the App's, over the showcase: what it lists is read from it.
    const asked = () => { const b = app.bar; return b && !b.ended() && b.scope === "ask" ? b.items.map(i => `${i.row.group} = ${i.row.label}`) : []; };
    press({ kind: "enter" });
    await until(() => asked()[0] === "Rules · rule-match · rule-match = type=bay-job", "the question, its value now first", 5000)
      .catch(e => { throw new Error(`${e.message}\n${JSON.stringify(asked())}`); });
    // Typing builds the query: the last clause offered from this outline's own properties and values.
    for (const c of "type=bay-job AND status=t") ch(c);
    await until(() => asked().includes("Rules · rule-match · rule-match = type=bay-job AND status=todo"), "the clause from the outline's own values", 5000)
      .catch(e => { throw new Error(`${e.message}\n${JSON.stringify(asked())}`); });
    // Changed elsewhere while the person chose: their answer is refused, never written over the change.
    await app.act({ action: "settings.set", tile: "reader", args: { key: "rule-label", value: "{{this.title}}" }, as: "test-agent" });
    while (!(app.bar!.items[app.bar!.selected]?.row.label === "type=bay-job AND status=todo")) press({ kind: "down" });
    press({ kind: "enter" });
    await Bun.sleep(500);
    expect(await text()).toContain("[rule-match::type=bay-job]");
    expect(await text()).toContain("[rule-label::{{this.title}}]");
    // Asked again, on the note as it is now: written.
    if (app.bar && !app.bar.ended()) press({ kind: "esc" });
    await until(() => !app.bar || app.bar.ended(), "the bar put away", 3000);
    press({ kind: "enter" });
    await until(() => asked()[0] === "Rules · rule-match · rule-match = type=bay-job", "asked again", 5000);
    for (const c of "type=bay-job AND status=t") ch(c);
    await until(() => asked().includes("Rules · rule-match · rule-match = type=bay-job AND status=todo"), "the clause again", 5000);
    while (!(app.bar!.items[app.bar!.selected]?.row.label === "type=bay-job AND status=todo")) press({ kind: "down" });
    press({ kind: "enter" });
    for (let i = 0; i < 80 && !(await text()).includes("[rule-match::type=bay-job AND status=todo]"); i++) await Bun.sleep(50);
    expect(await text()).toContain("[rule-match::type=bay-job AND status=todo]");
    // The area's card, by keys: both sections drawn, the echo name picked in the bar and written.
    const area = seeded.notes.echoArea.id, areaText = async () => (await board.get(area))!.text;
    for (let i = 0; i < 2 && app.bar && !app.bar.ended(); i++) press({ kind: "esc" });
    press({ kind: "esc" });
    await until(() => !screen().includes("settings · Rules"), "the rule's card closed", 3000).catch(e => { throw new Error(`${e.message}\n${screen()}`); });
    press({ kind: "tab" });
    await until(() => (S().stages.get(at)?.top.focus ?? "") === "reader2" || screen().includes("2 reader ═"), "the area's reader focused", 3000).catch(() => {});
    ch(",");
    await until(() => screen().includes("settings · Views + EchoNet areas") && screen().includes("  EchoNet areas"), "both sections", 5000)
      .catch(e => { throw new Error(`${e.message}\n${screen()}`); });
    press({ kind: "enter" });
    for (let i = 0; i < 12 && !screen().includes("echo · text"); i++) { ch("j"); await Bun.sleep(20); }
    expect(screen()).toContain("echo · text");
    press({ kind: "enter" });
    await until(() => asked()[0] === "EchoNet areas · echo · echo = plot.chat", "the area's name asked, its own first", 5000)
      .catch(e => { throw new Error(`${e.message}\n${JSON.stringify(asked())}`); });
    for (const c of "plot.talk") ch(c);
    await until(() => asked()[0] === "EchoNet areas · echo · echo = plot.talk", "the name as typed", 5000).catch(e => { throw new Error(`${e.message}\n${JSON.stringify(asked())}`); });
    press({ kind: "enter" });
    for (let i = 0; i < 80 && !(await areaText()).includes("[echo::plot.talk]"); i++) await Bun.sleep(50);
    expect(await areaText()).toContain("[echo::plot.talk] [query::type=plot-post]");
    // Put back for the sections after this one.
    await app.act({ action: "settings.set", tile: "reader2", args: { key: "echo", value: "plot.chat" }, as: "test-agent" });
    expect(await areaText()).toContain("[echo::plot.chat]");
    // The view's query is what the area requires: clearing it is refused, as clearing the area's name would be.
    await expect(app.act({ action: "settings.clear", tile: "reader2", args: { key: "query" }, as: "test-agent" })).rejects.toThrow("what makes this note");
    await expect(app.act({ action: "settings.clear", tile: "reader2", args: { key: "echo" }, as: "test-agent" })).rejects.toThrow("what makes this note");
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 60_000);
});
