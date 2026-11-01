import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Subprocess } from "bun";
import { agentAddress, agentTerminals, hc, readTerminal, startNamedAgent, type HcRow, type HcTerminal, type NamedAgent } from "../named-agent";
import { JsonLines } from "../jsonl";
import { alive } from "../state";
import { keyName } from "../surface/actions";
import { effective, keyTable } from "../surface/keymap";
import { HomeSurface } from "../surface/home";
import type { Key } from "../term";
import type { DeskApi, PaneView } from "./panes";
import { PtyPane } from "./pty";

export const NAMED_AGENT_KEYS = keyTable("named-agent", "A named agent's card", [
  { key: "enter", action: "agent.launch", label: "start the named agent" },
  { key: "s", action: "agent.shell", label: "a shell here" },
  { key: "r", action: "agent.attach", label: "look again" },
]);

/** The shared terminal tile displays hc's attach; hc alone owns the agent's program. */
export class NamedAgentPane extends PtyPane {
  override get named(): NamedAgentPane { return this; }
  terminal: HcTerminal | null = null;
  available: HcRow[] = [];
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
  private size = { cols: 80, rows: 24 };
  private cardLines: string[] = [];
  private lease: string | null = null;

  constructor(readonly config: NamedAgent, private readonly env: Record<string, string | undefined> = process.env) {
    super({ cmd: ["hc", "attach", agentAddress(config, env)], label: config.persona, agent: true, inShell: false, session: { program: config.program[0] ?? config.persona, persona: config.persona } });
  }
  override init(desk: DeskApi) { super.init(desk); this.host = desk; }
  override spec() { return { ...super.spec(), namedAgent: this.config }; }
  override get keptAs() { return null; }
  override title() { return `${this.config.persona} · ${this.config.machine}${this.observing ? " · watching" : ""}`; }
  override hint() { return this.card ? effective(NAMED_AGENT_KEYS).map(k => `${k.key} ${k.label}`).join(" · ") : super.hint(); }
  get card() { return !this.attaching || this.exited !== null; }

  override startNow(cols = 80, rows = 24) {
    this.size = { cols, rows };
    if (!this.began) { this.began = true; void this.refresh(); }
  }

  /** A second door watches, so its first paint cannot resize or type into the first door's terminal. */
  private claim(): boolean {
    const dir = join(this.env.XDG_RUNTIME_DIR || join(tmpdir(), `ep0ch-${process.getuid?.() ?? 0}`), "hc-attachments");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = createHash("sha256").update(`${this.env.HC_SESSION ?? ""}:${agentAddress(this.config, this.env)}`).digest("hex");
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
    this.available = await agentTerminals(this.config, this.env);
    const matches = this.available.filter(t => t.name === this.config.persona);
    const found = matches.find(t => t.state === "live") ?? matches.at(-1);
    if (this.disposed) return;
    if (!found) { this.message = `no agent named ${this.config.persona} on ${this.config.machine}`; return; }
    const terminal = await readTerminal(found.address, this.env);
    if (this.disposed) return;
    this.terminal = terminal;
    if (terminal.state !== "live") {
      this.attaching = false;
      this.message = `${this.config.persona} ended · exit ${terminal.exit_code ?? terminal.reason ?? "unknown"}`;
      this.tail = await hc(["read", terminal.address, "--lines", "8"], this.env);
      this.release();
      return;
    }
    if (this.attaching && this.exited === null) return;
    this.stopEvents();
    this.onExit = null;
    await super.stop();
    this.release();
    if (this.disposed) return;
    this.observing = !this.claim();
    this.run.cmd = ["hc", "attach", agentAddress(this.config, this.env), ...(this.observing ? ["--observe"] : [])];
    this.attaching = true;
    this.run.own = Object.fromEntries(Object.entries(this.env).filter(([key]) => key.startsWith("HC_") || key.startsWith("XDG_")).map(([key, value]) => [key, value ?? null]));
    super.start(this.size.cols, this.size.rows);
    this.onExit = () => {
      if (this.disposed) return;
      this.attaching = false;
      this.release();
      this.stopEvents();
      // Detaching must not attach again or start another program behind the person's back.
      void this.endedCard();
    };
    this.watchEvents(terminal.address);
  }
  private async endedCard() {
    try {
      if (this.terminal) this.terminal = await readTerminal(this.terminal.address, this.env);
      this.message = this.terminal?.state === "finished"
        ? `${this.config.persona} ended · exit ${this.terminal.exit_code ?? this.terminal.reason ?? "unknown"}`
        : `Detached from ${this.config.persona} · r looks again`;
      if (this.terminal) this.tail = await hc(["read", this.terminal.address, "--lines", "8"], this.env);
      this.available = await agentTerminals(this.config, this.env);
    } catch (e) { this.message = (e as Error).message; }
    this.host?.redraw();
  }
  private watchEvents(address: string) {
    const p = Bun.spawn(["hc", "events", "--terminal", address], { env: this.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    this.events = p;
    let reading = false, dirty = false;
    const update = (t: HcTerminal) => {
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
        while (dirty && this.events === p) { dirty = false; update(await readTerminal(address, this.env)); }
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
    if (!this.config.program.length) throw new Error(`Add ${this.config.persona}'s launch line to .ep0ch/agents.toml, then ep0ch agent start ${this.config.persona}`);
    await startNamedAgent(this.config, this.env);
    await this.refresh();
    return { persona: this.config.persona, address: this.terminal?.address };
  }
  override restart() { void this.refresh(); }
  override render(w: number, h: number, focused: boolean, desk: DeskApi, cursor = focused): PaneView {
    this.startNow(w, h);
    if (!this.card) return super.render(w, h, focused, desk, cursor);
    this.cardLines = this.homeSurface.card(this.message, [
      `hc ls on ${this.config.machine}: ${this.available.map(t => `${t.name ?? t.address} (${t.state})`).join(", ") || "none"}`,
      ...this.tail.split("\n").filter(Boolean).slice(-8),
    ], [
      { label: `ep0ch agent start ${this.config.persona}`, action: "agent.launch" },
      { label: "a shell here", action: "agent.shell" },
    ], w, h);
    return { lines: this.cardLines };
  }
  press(k: Key): { action: string } | null {
    if (!this.card) return null;
    if (k.kind === "mouse") { let hit: string | null = null; this.homeSurface.press(k, a => { hit = a; }); return hit ? { action: hit } : null; }
    const bound = effective(NAMED_AGENT_KEYS).find(b => b.key === keyName(k));
    return bound ? { action: bound.action } : null;
  }
  override typed(k: Key) {
    if (!this.card) return super.typed(k);
    const press = this.press(k);
    if (press) void this.host?.perform?.(press.action, {}, undefined, this);
    return !!press;
  }
  override text() { return this.card ? this.cardLines : super.text(); }
  override describe() { return { ...super.describe(), namedAgent: { ...this.config, terminal: this.terminal?.address, state: this.terminal?.state ?? "missing", observing: this.observing, card: this.card, message: this.message, available: this.available, tail: this.tail } }; }
  override dispose() { this.disposed = true; this.stopEvents(); this.release(); super.dispose(); }
}
