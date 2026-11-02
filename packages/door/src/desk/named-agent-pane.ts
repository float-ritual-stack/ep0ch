import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import type { Subprocess } from "bun";
import { hcAddress, hcAttachArgv, hc, namedAgentButtons, namedFromFolder, readNamedTerminal, seeNamed, startNamedAgent, type HcGot, type NamedAgent, type NamedLook } from "./named-agent";
import { JsonLines } from "../jsonl";
import { alive } from "../state";
import { keyName } from "../surface/actions";
import { effective, keyTable } from "../surface/keymap";
import { HomeSurface } from "../surface/home";
import { probe } from "../surface/probe";
import { USER } from "../socket";
import type { Key } from "../term";
import type { DeskApi, PaneView } from "./panes";
import { PtyPane } from "./pty";

export const NAMED_AGENT_KEYS = keyTable("named-agent", "A named agent's card", [
  { key: "enter", action: "named.start", label: "start the named agent" },
  { key: "s", action: "named.shell", label: "a shell here" },
  { key: "r", action: "named.attach", label: "look again" },
]);

/** The shared terminal tile displays hc's attach; hc alone owns the agent's program. */
export class NamedAgentPane extends PtyPane {
  override get named(): NamedAgentPane { return this; }
  terminal: HcGot | null = null;
  look: NamedLook | null = null;
  observing = false;
  message = "Looking for the named agent…";
  tail = "";
  private homeSurface = new HomeSurface();
  private host: DeskApi | null = null;
  private events: Subprocess | null = null;
  private loading: Promise<void> | null = null;
  private began = false;
  private disposed = false;
  private attaching = false;
  private attachSize = { cols: 80, rows: 24 };
  private cardLines: string[] = [];
  private lease: string | null = null;

  constructor(readonly config: NamedAgent, private readonly env: Record<string, string | undefined> = process.env) {
    super({ cmd: ["hc", "attach", hcAddress(config, env)], label: config.persona, agent: true, inShell: false, session: { program: config.persona, persona: config.persona } });
  }
  override init(desk: DeskApi) { super.init(desk); this.host = desk; }
  override spec() { return { ...super.spec(), namedAgent: this.config }; }
  override get keptAs() { return null; }
  override title() { return `${this.config.persona} · ${this.config.machine || "this machine"}${this.observing ? " · watching" : ""}`; }
  override hint() { return this.card ? effective(NAMED_AGENT_KEYS).map(k => `${k.key} ${k.label}`).join(" · ") : super.hint(); }
  get card() { return !this.attaching || this.exited !== null; }
  override get showsTerminal() { return !this.card; }

  override startNow(cols = 80, rows = 24) {
    this.attachSize = { cols, rows };
    if (!this.began) { this.began = true; void this.refresh(); }
  }

  /** A second door watches, so its first paint cannot resize or type into the first door's terminal. */
  private claim(): boolean {
    const dir = join(this.env.XDG_RUNTIME_DIR || join(tmpdir(), `ep0ch-${process.getuid?.() ?? 0}`), "hc-attachments");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = createHash("sha256").update(`${this.env.HC_SESSION ?? ""}:${hcAddress(this.config, this.env)}`).digest("hex");
    const file = join(dir, key);
    try {
      const pid = Number(readFileSync(file, "utf8"));
      if (alive(pid)) return false;
      unlinkSync(file);
    } catch { /* no viewer */ }
    try { writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 }); this.lease = file; return true; }
    catch { return false; }
  }
  private release() { if (this.lease) { try { unlinkSync(this.lease); } catch { /* removed */ } this.lease = null; } }

  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.find().catch(e => { this.message = (e as Error).message; }).finally(() => { this.loading = null; this.host?.redraw(); });
    return this.loading;
  }
  private async find() {
    probe("named.attach");
    this.look = await seeNamed(this.config, this.env);
    if (this.disposed) return;
    if (this.look.kind !== "live") {
      this.attaching = false;
      this.message = this.look.title;
      this.release();
      return;
    }
    const terminal = this.look.terminal;
    this.terminal = terminal;
    if (this.attaching && this.exited === null) return;
    this.stopEvents();
    this.onExit = null;
    await super.stop();
    this.release();
    if (this.disposed) return;
    this.observing = !this.claim();
    this.message = `${this.observing ? "Watching" : "Attached to"} ${this.config.persona}`;
    this.run.cmd = hcAttachArgv(this.config, this.observing, this.env);
    this.attaching = true;
    this.run.own = Object.fromEntries(Object.entries(this.env).filter(([key]) => key.startsWith("HC_") || key.startsWith("XDG_")).map(([key, value]) => [key, value ?? null]));
    super.start(this.attachSize.cols, this.attachSize.rows);
    this.onExit = () => {
      if (this.disposed) return;
      this.attaching = false;
      this.release();
      this.stopEvents();
      // Detaching must not attach again or start another program behind the person's back.
      void this.endedCard();
    };
    this.watchEvents(this.look.address);
  }
  private async endedCard() {
    try {
      if (this.terminal) this.terminal = await readNamedTerminal(this.terminal.address!, this.env);
      this.message = this.terminal?.state === "finished"
        ? `${this.config.persona} ended · exit ${this.terminal.exit_code ?? this.terminal.reason ?? "unknown"}`
        : `Detached from ${this.config.persona} · r looks again`;
      if (this.terminal) this.tail = await hc(["read", this.terminal.address!, "--lines", "8"], this.env);
      this.look = await seeNamed(this.config, this.env);
    } catch (e) { this.message = (e as Error).message; }
    this.host?.redraw();
  }
  private watchEvents(address: string) {
    const p = Bun.spawn(["hc", "events", "--terminal", address], { env: this.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    this.events = p;
    let reading = false, dirty = false;
    const update = (t: HcGot) => {
      if (this.events !== p) return;
      this.terminal = t;
      this.status.reset();
      for (const [id, r] of Object.entries({ ...(t.status ? { "": t.status } : {}), ...t.records }))
        this.status.report({ id, state: r.state, ...(r.app ? { app: r.app } : {}), ...(r.msg ? { message: r.msg } : {}), ...(r.title ? { title: r.title } : {}), ...(r.kind ? { kind: r.kind } : {}), ...(r.progress != null ? { progress: r.progress } : {}) });
      if (t.state === "finished") { this.attaching = false; this.release(); void this.endedCard(); }
      this.host?.redraw();
    };
    const changed = async () => {
      dirty = true;
      if (reading) return;
      reading = true;
      try {
        while (dirty && this.events === p) { dirty = false; update(await readNamedTerminal(address, this.env)); }
      } catch (e) { this.message = (e as Error).message; }
      finally { reading = false; }
    };
    void (async () => {
      const lines = new JsonLines(rec => {
        if (rec.terminals?.[0]) update(rec.terminals[0]);
        else if (rec.method === "event" && ["status", "turn", "finished", "lost", "restarted"].includes(rec.params?.type)) void changed();
      });
      for await (const chunk of p.stdout as ReadableStream<Uint8Array>) lines.feed(Buffer.from(chunk));
      const error = await new Response(p.stderr).text();
      if (this.events === p && error) { this.message = error.trim(); this.attaching = false; this.host?.redraw(); }
    })();
  }
  private stopEvents() { const p = this.events; this.events = null; p?.kill(); }

  async launch() {
    probe("named.launch");
    if (this.config.declarationFolder) {
      const current = namedFromFolder({ start: this.config.declarationFolder, persona: this.config.persona, outline: this.config.outline, machine: this.config.outlineMachine ?? null, home: this.env.HOME ?? homedir() });
      if (!current) throw new Error(`Add ${this.config.persona}'s row to ${this.config.declarationFolder}/.ep0ch/agents.toml before starting it`);
      Object.assign(this.config, current);
    }
    if (!this.config.program.length) throw new Error(`Add ${this.config.persona}'s launch line to .ep0ch/agents.toml, then ep0ch agent start ${this.config.persona}`);
    const result = await startNamedAgent(this.config, this.env);
    if (!result.ok) throw new Error(result.error);
    await this.refresh();
    return { persona: this.config.persona, address: result.address, started: result.started };
  }
  override restart() { void this.refresh(); }
  override render(w: number, h: number, focused: boolean, desk: DeskApi, cursor = focused): PaneView {
    this.startNow(w, h);
    if (!this.card) return super.render(w, h, focused, desk, cursor);
    this.cardLines = this.homeSurface.renderCard({ title: this.message, lines: this.look && this.look.kind !== "live" ? this.look.lines : this.tail.split("\n").filter(Boolean).slice(-8), buttons: namedAgentButtons(this.config.persona) }, w, h);
    return { lines: this.cardLines };
  }
  press(k: Key): { action: string } | null {
    if (!this.card) return null;
    if (k.kind === "mouse") return null;
    const bound = effective(NAMED_AGENT_KEYS).find(b => b.key === keyName(k));
    return bound ? { action: bound.action } : null;
  }
  override typed(k: Key) {
    if (!this.card) return super.typed(k);
    const press = this.press(k);
    if (press) void this.host?.perform?.(press.action, {}, USER, this);
    return !!press;
  }
  override mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number): boolean {
    if (!this.card) return super.mouse(k, x, y);
    // The desk gives mouse() tile coordinates; a kind's press hook sees screen coordinates.
    return this.homeSurface.press({ ...k, x, y }, action => { void this.host?.perform?.(action, {}, USER, this); });
  }
  override text() { return this.card ? this.cardLines : super.text(); }
  override describe() { return { ...super.describe(), namedAgent: { ...this.config, terminal: this.terminal?.address, state: this.terminal?.state ?? "missing", observing: this.observing, card: this.card, message: this.message, look: this.look, tail: this.tail } }; }
  override dispose() { this.disposed = true; this.stopEvents(); this.release(); super.dispose(); }
}
