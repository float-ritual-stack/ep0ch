// What the door needs from the outline, independent of the wire protocol.

export interface Msg {
  id: string;
  text: string;
  parentId: string | null;
  childIds: string[];
  createdAt: number;   // epoch ms
  updatedAt: number;
  author: string | null;
  props: Record<string, string>;
}

export interface Caller {
  id: string;
  name: string;        // what the client calls itself
  host: string;
  activity: string;
  since: number | null;
  target?: string | null;  // block id the caller is looking at
}

export interface BoardInfo { host: string; workspace: string; protocol: number; blocks: number | null }

export interface Board {
  info(): Promise<BoardInfo>;
  roots(): Promise<Msg[]>;
  get(id: string): Promise<Msg | null>;
  children(id: string): Promise<Msg[]>;
  /** Blocks whose updatedAt is after `since`, newest first. */
  changedSince(since: number, limit: number): Promise<Msg[]>;
  search(text: string, limit: number): Promise<Msg[]>;
  callers(): Promise<Caller[]>;
  close(): void;
}

export const subject = (m: Msg) => (m.text.split("\n").find(l => l.trim()) ?? "(empty)").replace(/\[[\w-]+::[^\]]*\]/g, "").trim() || "(untitled)";
