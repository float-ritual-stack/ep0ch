// MessagePack, as much as nvim's RPC uses (https://github.com/msgpack/msgpack/blob/master/spec.md): nil, booleans,
// integers, floats, strings, binary, arrays, maps, and ext (nvim's Buffer, Window and Tabpage handles). Small
// on purpose: the door speaks to an nvim tile's socket with it and nothing else.

/** An ext value: nvim's handles are ext 0 (Buffer), 1 (Window), 2 (Tabpage), their data a msgpack integer. */
export class Ext { constructor(readonly type: number, readonly data: Uint8Array) {} }

export function encode(v: unknown): Uint8Array {
  const out: number[] = [];
  const u8 = (n: number): void => { out.push(n & 255); };
  const be = (n: number, bytes: number) => { for (let i = bytes - 1; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 255); };
  const go = (x: unknown): void => {
    if (x === null || x === undefined) return u8(0xc0);
    if (x === false) return u8(0xc2);
    if (x === true) return u8(0xc3);
    if (typeof x === "number") {
      if (Number.isInteger(x)) {
        if (x >= 0 && x < 128) return u8(x);
        if (x < 0 && x >= -32) return u8(0xe0 | (x + 32));
        if (x >= 0) { if (x < 256) { u8(0xcc); return u8(x); } if (x < 65536) { u8(0xcd); return be(x, 2); } if (x < 2 ** 32) { u8(0xce); return be(x, 4); } u8(0xcf); return be(x, 8); }
        if (x >= -128) { u8(0xd0); return u8(x & 255); }
        if (x >= -32768) { u8(0xd1); return be(x & 0xffff, 2); }
        if (x >= -(2 ** 31)) { u8(0xd2); return be(x >>> 0, 4); }
      }
      const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); u8(0xcb);
      for (let i = 0; i < 8; i++) u8(b.getUint8(i));
      return;
    }
    if (typeof x === "string") {
      const s = new TextEncoder().encode(x), n = s.length;
      if (n < 32) u8(0xa0 | n); else if (n < 256) { u8(0xd9); u8(n); } else if (n < 65536) { u8(0xda); be(n, 2); } else { u8(0xdb); be(n, 4); }
      for (const c of s) u8(c);
      return;
    }
    if (x instanceof Uint8Array) { const n = x.length; if (n < 256) { u8(0xc4); u8(n); } else if (n < 65536) { u8(0xc5); be(n, 2); } else { u8(0xc6); be(n, 4); } for (const c of x) u8(c); return; }
    if (x instanceof Ext) { const n = x.data.length; u8(0xc7); u8(n); u8(x.type); for (const c of x.data) u8(c); return; }
    if (Array.isArray(x)) { const n = x.length; if (n < 16) u8(0x90 | n); else if (n < 65536) { u8(0xdc); be(n, 2); } else { u8(0xdd); be(n, 4); } for (const e of x) go(e); return; }
    if (typeof x === "object") {
      const es = Object.entries(x as object), n = es.length;
      if (n < 16) u8(0x80 | n); else if (n < 65536) { u8(0xde); be(n, 2); } else { u8(0xdf); be(n, 4); }
      for (const [k, e] of es) { go(k); go(e); }
      return;
    }
    throw new TypeError(`msgpack can't encode ${typeof x}`);
  };
  go(v);
  return Uint8Array.from(out);
}

/** Not enough bytes yet: the rest of the value is still coming. */
export class Incomplete extends Error {}

/** One value from `buf` at `at`: the value and where the next one starts. Throws Incomplete when cut short. */
export function decode(buf: Uint8Array, at = 0): { value: unknown; next: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = at;
  const need = (n: number) => { if (i + n > buf.length) throw new Incomplete(); };
  const uint = (n: number) => { need(n); let v = 0; for (let k = 0; k < n; k++) v = v * 256 + buf[i + k]!; i += n; return v; };
  const str = (n: number) => { need(n); const s = new TextDecoder().decode(buf.subarray(i, i + n)); i += n; return s; };
  const bytes = (n: number) => { need(n); const b = buf.slice(i, i + n); i += n; return b; };
  const go = (): unknown => {
    need(1);
    const t = buf[i++]!;
    if (t < 0x80) return t;
    if (t >= 0xe0) return t - 256;
    if ((t & 0xf0) === 0x80) return map(t & 15);
    if ((t & 0xf0) === 0x90) return arr(t & 15);
    if ((t & 0xe0) === 0xa0) return str(t & 31);
    switch (t) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return bytes(uint(1));
      case 0xc5: return bytes(uint(2));
      case 0xc6: return bytes(uint(4));
      case 0xc7: { const n = uint(1), ty = uint(1); return new Ext(ty, bytes(n)); }
      case 0xc8: { const n = uint(2), ty = uint(1); return new Ext(ty, bytes(n)); }
      case 0xc9: { const n = uint(4), ty = uint(1); return new Ext(ty, bytes(n)); }
      case 0xca: { need(4); const f = dv.getFloat32(i); i += 4; return f; }
      case 0xcb: { need(8); const f = dv.getFloat64(i); i += 8; return f; }
      case 0xcc: return uint(1);
      case 0xcd: return uint(2);
      case 0xce: return uint(4);
      case 0xcf: return uint(8);
      case 0xd0: { need(1); const v = dv.getInt8(i); i += 1; return v; }
      case 0xd1: { need(2); const v = dv.getInt16(i); i += 2; return v; }
      case 0xd2: { need(4); const v = dv.getInt32(i); i += 4; return v; }
      case 0xd3: { need(8); const v = Number(dv.getBigInt64(i)); i += 8; return v; }
      case 0xd4: { const ty = uint(1); return new Ext(ty, bytes(1)); }
      case 0xd5: { const ty = uint(1); return new Ext(ty, bytes(2)); }
      case 0xd6: { const ty = uint(1); return new Ext(ty, bytes(4)); }
      case 0xd7: { const ty = uint(1); return new Ext(ty, bytes(8)); }
      case 0xd8: { const ty = uint(1); return new Ext(ty, bytes(16)); }
      case 0xd9: return str(uint(1));
      case 0xda: return str(uint(2));
      case 0xdb: return str(uint(4));
      case 0xdc: return arr(uint(2));
      case 0xdd: return arr(uint(4));
      case 0xde: return map(uint(2));
      case 0xdf: return map(uint(4));
    }
    throw new TypeError(`msgpack: unknown type byte 0x${t.toString(16)}`);
  };
  const arr = (n: number) => Array.from({ length: n }, () => go());
  const map = (n: number) => { const o: Record<string, unknown> = {}; for (let k = 0; k < n; k++) { const key = go(); o[String(key)] = go(); } return o; };
  const value = go();
  return { value, next: i };
}

/** An nvim handle (Buffer, Window, Tabpage) as its number. */
export const handle = (x: unknown): number | null => (x instanceof Ext ? (decode(x.data).value as number) : typeof x === "number" ? x : null);
