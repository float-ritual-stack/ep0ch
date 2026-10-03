// An nvim tile's socket (`nvim --listen <sock>`): the door's own connection to it, and the path an agent uses
// for its own. nvim's RPC is msgpack over the socket (requests, responses, notifications). The door asks nvim to
// tell it when the cursor, the window's lines or the buffer change (autocmds that `rpcnotify` it), so the
// person's cursor in nvim is in `view.subscribe`, and a preview following the tile follows the buffer's file.
// An agent reads the cursor and edits other lines through the same socket (nvim_buf_set_lines): nvim moves no
// one's cursor for that. Attention marks in an nvim tile are extmarks with virtual text.
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decode, encode, Incomplete } from "../msgpack";
import { privateDir, stateDir } from "../state";

/**
 * Where nvim tiles listen: the door's state (nvim/); when that path is too long for a socket (about 100
 * bytes), $XDG_RUNTIME_DIR (the user's own), else a folder under the temp directory. That folder is used only
 * when it's this user's and nobody else's (mode 700); otherwise null, and nvim runs without a socket.
 */
export function nvimSocketPath(name: string): string | null {
  const file = `${name.replace(/[^\w.-]/g, "_").slice(0, 24)}-${process.pid}-${Math.random().toString(36).slice(2, 7)}.sock`;
  const fits = (dir: string) => join(dir, file).length < 100;
  const uid = process.getuid?.();
  const dirs = [join(stateDir(), "nvim"), ...(process.env.XDG_RUNTIME_DIR ? [join(process.env.XDG_RUNTIME_DIR, "ep0ch-nvim")] : []), join(tmpdir(), `ep0ch-nvim-${uid ?? "u"}`)];
  for (const dir of dirs.filter(fits)) if (privateDir(dir)) return join(dir, file);
  return null;
}

/** What nvim said about its window last: the buffer's file, the cursor (1-based line, 0-based col), the lines in view, the mode. */
export interface NvimView { file: string; line: number; col: number; top: number; bottom: number; mode: string }

const WATCH = `
local chan = ...
local g = vim.api.nvim_create_augroup("ep0ch_door", { clear = true })
local function send()
  local c = vim.api.nvim_win_get_cursor(0)
  vim.rpcnotify(chan, "ep0ch_view", { file = vim.api.nvim_buf_get_name(0), line = c[1], col = c[2], top = vim.fn.line("w0"), bottom = vim.fn.line("w$"), mode = vim.api.nvim_get_mode().mode })
end
vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI", "BufEnter", "WinScrolled", "ModeChanged", "BufWritePost" }, { group = g, callback = send })
send()
`;

export class NvimClient {
  private sock: Socket | null = null;
  private buf: Uint8Array = new Uint8Array(0);
  private id = 1;
  private waiting = new Map<number, { ok: (v: unknown) => void; no: (e: Error) => void }>();
  /** The last view nvim reported. */
  view: NvimView | null = null;
  onView: ((v: NvimView) => void) | null = null;

  constructor(readonly path: string) {}

  /** Connect, retrying while nvim starts (it makes the socket a moment after it runs). */
  async connect(ms = 5000): Promise<void> {
    const end = Date.now() + ms;
    for (;;) {
      try { await this.open(); return; } catch (e) { if (Date.now() > end) throw e; await Bun.sleep(100); }
    }
  }

  private open(): Promise<void> {
    return new Promise((ok, no) => {
      const s = connect(this.path);
      s.once("connect", () => { this.sock = s; ok(); });
      s.once("error", no);
      s.on("data", (d: Buffer) => this.feed(new Uint8Array(d)));
      // Only the live socket's close counts: a failed attempt from while nvim was starting closes late.
      s.on("close", () => { if (this.sock === s) this.gone(); });
    });
  }

  private feed(d: Uint8Array) {
    const all = new Uint8Array(this.buf.length + d.length);
    all.set(this.buf); all.set(d, this.buf.length);
    let at = 0;
    for (;;) {
      let r: { value: unknown; next: number };
      // Something nvim sent that isn't msgpack we can read: dropped (the connection goes on), never thrown.
      try { r = decode(all, at); } catch (e) { if (e instanceof Incomplete) break; at = all.length; break; }
      at = r.next;
      const m = r.value as unknown[];
      if (m[0] === 1) {
        const w = this.waiting.get(m[1] as number);
        this.waiting.delete(m[1] as number);
        if (m[2]) w?.no(new Error(Array.isArray(m[2]) ? String(m[2][1]) : JSON.stringify(m[2]))); else w?.ok(m[3]);
      } else if (m[0] === 2 && m[1] === "ep0ch_view") {
        this.view = (m[2] as unknown[])[0] as NvimView;
        this.onView?.(this.view);
      }
    }
    this.buf = all.slice(at);
  }

  /** A request, answered within `ms` or refused: a busy or stuck nvim never hangs the door. */
  request(method: string, params: unknown[], ms = 5000): Promise<unknown> {
    const s = this.sock;
    if (!s) return Promise.reject(new Error("not connected to nvim"));
    const id = this.id++;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { this.waiting.delete(id); no(new Error(`nvim didn't answer ${method} within ${ms / 1000}s`)); }, ms);
      this.waiting.set(id, { ok: v => { clearTimeout(t); ok(v); }, no: e => { clearTimeout(t); no(e); } });
      s.write(encode([0, id, method, params]));
    });
  }

  /** Run Lua in nvim with `args` as `...`. */
  lua(code: string, args: unknown[] = []): Promise<unknown> { return this.request("nvim_exec_lua", [code, args]); }

  /** Ask nvim to report its view (cursor, lines in view, buffer) on every change. */
  async watch(): Promise<void> {
    const info = await this.request("nvim_get_api_info", []) as [number, unknown];
    await this.lua(WATCH, [info[0]]);
  }

  /** An attention mark on `line` (1-based) of the buffer showing `file` (or the current one): virtual text at its end. */
  async mark(line: number, text: string, file?: string): Promise<number> {
    return await this.lua(`
      local line, text, file = ...
      local buf = (file and file ~= "") and vim.fn.bufnr(file) or vim.api.nvim_get_current_buf()
      if buf < 0 then buf = vim.api.nvim_get_current_buf() end
      local ns = vim.api.nvim_create_namespace("ep0ch_marks")
      local n = vim.api.nvim_buf_line_count(buf)
      return vim.api.nvim_buf_set_extmark(buf, ns, math.min(line, n) - 1, 0, { virt_text = { { "◆ " .. text, "WarningMsg" } }, virt_text_pos = "eol", sign_text = "◆", sign_hl_group = "WarningMsg" })
    `, [line, text, file ?? ""]) as number;
  }
  async unmark(id: number, file?: string): Promise<void> {
    await this.lua(`
      local id, file = ...
      local ns = vim.api.nvim_create_namespace("ep0ch_marks")
      for _, b in ipairs(vim.api.nvim_list_bufs()) do pcall(vim.api.nvim_buf_del_extmark, b, ns, id) end
    `, [id, file ?? ""]);
  }

  close() { this.sock?.destroy(); this.gone(); }

  private gone() {
    this.sock = null;
    for (const w of this.waiting.values()) w.no(new Error("nvim went away"));
    this.waiting.clear();
  }
}
