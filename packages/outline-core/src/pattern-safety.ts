// Why a rule's text pattern could take forever on one line, or undefined when it can't. Pure, no I/O.
//
// The service tests every line of every note against a rule's pattern with no deadline, and a JS regex can't be
// interrupted. So a pattern is read structurally (escapes, classes and groups) and refused when backtracking can
// blow up:
//   - a repeated group that holds a repetition, an optional atom or alternatives at any depth (`((a+))+`, `(a|aa)*`,
//     `(a?a?)+`, `(a{1,9}){1,9}`), and any backreference;
//   - repeating or optional atoms that can match the same characters, side by side: the pattern runs from every
//     start of a line, so k of them cost n^(k+1) steps (`a*a*a*b` on 1000 a's took 15 s; `a*aa*aa*b`, `a?a?a?a{3}b`
//     and `(a*)?(a*)?(a*)?` the same). What an atom matches is read off the atom itself, compiled with the
//     pattern's flags and tried on every code unit, so `\x61*`, `[a-z]*` and a case-folded `A` count as overlapping
//     and `a+b+c+` or `\s*(\S…)` don't. A required atom (a literal, a class, `x+`) that can't match what an earlier
//     atom matches ends that atom's part in the run.

/** An atom may overlap at most this many earlier ones of the run: 2 stars side by side on the line cap are about 10^7 steps. */
export const MAX_OVERLAPPING = 1;

/** What an atom matches, one flag per UTF-16 code unit and two astral probes; `null` is anything (a group, `.`). */
type CharSet = Uint8Array | null;
const ASTRAL = [0x10000, 0x1f600];

interface Atom { set: CharSet }

interface Frame {
  /** Whether the group so far holds a repeating or optional atom, or alternatives. */
  repeats: boolean;
  alternates: boolean;
  /** The run on entry, and the longest run any branch of the group reached. */
  before: Atom[];
  longest: Atom[];
}

/** The quantifier at `i`: how far it reaches (past a lazy `?`), whether it repeats, and whether it can match nothing. */
function quantifierAt(raw: string, i: number): { end: number; repeats: boolean; optional: boolean } | undefined {
  const c = raw[i];
  let end: number, repeats: boolean, optional = false;
  if (c === "+" || c === "*") { end = i + 1; repeats = true; optional = c === "*"; }
  else if (c === "?") { end = i + 1; repeats = false; optional = true; }
  else if (c === "{") {
    const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(raw.slice(i));
    if (!m) return undefined;
    end = i + m[0].length;
    optional = Number(m[1]) === 0;
    repeats = m[2] ? m[3] === "" || Number(m[3]) > 1 : Number(m[1]) > 1;
  } else return undefined;
  if (raw[end] === "?") end++;
  return { end, repeats, optional };
}

/** Where the escape that starts at `i` (a backslash) ends: `\x61`, `a`, `\u{61}`, `\cJ`, `\p{L}`, or two characters. */
function escapeEnd(raw: string, i: number): number {
  const k = raw[i + 1];
  if (k === "x") return i + 4;
  if (k === "u") return raw[i + 2] === "{" ? raw.indexOf("}", i) + 1 || raw.length : i + 6;
  if (k === "c") return i + 3;
  if ((k === "p" || k === "P") && raw[i + 2] === "{") return raw.indexOf("}", i) + 1 || raw.length;
  return i + 2;
}

function charSet(source: string, flags: string, cache: Map<string, CharSet>): CharSet {
  if (cache.has(source)) return cache.get(source)!;
  let set: CharSet = null;
  try {
    const re = new RegExp(`^(?:${source})$`, flags);
    const units = new Uint8Array(0x10000 + ASTRAL.length);
    for (let cp = 0; cp < 0x10000; cp++) units[cp] = re.test(String.fromCharCode(cp)) ? 1 : 0;
    ASTRAL.forEach((cp, n) => { units[0x10000 + n] = re.test(String.fromCodePoint(cp)) ? 1 : 0; });
    set = units;
  } catch { /* an atom we can't read matches anything */ }
  cache.set(source, set);
  return set;
}

const overlap = (a: Atom, b: Atom): boolean => {
  if (!a.set || !b.set) return true;
  for (let n = 0; n < a.set.length; n++) if (a.set[n] && b.set[n]) return true;
  return false;
};

export function unsafePatternReason(source: string, flags = "u"): string | undefined {
  const cache = new Map<string, CharSet>();
  const fresh = (before: Atom[]): Frame => ({ repeats: false, alternates: false, before, longest: before });
  const stack: Frame[] = [];
  let top = fresh([]);
  /** The repeating and optional atoms side by side so far. */
  let run: Atom[] = [];
  for (let i = 0; i < source.length;) {
    const c = source[i]!;
    let group: Frame | undefined;
    let atom: Atom | undefined;
    if (c === "\\") {
      if (/^[1-9]|^k</.test(source.slice(i + 1, i + 3))) return "a backreference (like \\1) can backtrack without bound";
      const end = escapeEnd(source, i);
      atom = /^\\[bB]/.test(source.slice(i, i + 2)) ? undefined : { set: charSet(source.slice(i, end), flags, cache) };
      i = end;
    } else if (c === "[") {
      const start = i++;
      while (i < source.length && source[i] !== "]") i += source[i] === "\\" ? 2 : 1;
      i++;
      atom = { set: charSet(source.slice(start, i), flags, cache) };
    } else if (c === "(") {
      stack.push(top);
      top = fresh(run);
      i += 1 + (/^\?(?:[:=!]|<[=!]|<[A-Za-z_]\w*>)/.exec(source.slice(i + 1))?.[0].length ?? 0);
      continue;
    } else if (c === ")") {
      group = top;
      if (group.longest.length > run.length) run = group.longest;
      top = stack.pop() ?? fresh([]);
      atom = { set: null };
      i++;
    } else if (c === "|") {
      top.alternates = true;
      if (run.length > top.longest.length) top.longest = run;
      run = top.before;
      i++;
      continue;
    } else if (c === "." || c === "^" || c === "$") {
      atom = c === "." ? { set: null } : undefined;
      i++;
    } else {
      atom = { set: charSet(c === "{" || c === "}" ? `\\${c}` : c, flags, cache) };
      i++;
    }
    const q = quantifierAt(source, i);
    if (q) i = q.end;
    if (q?.repeats && group && (group.repeats || group.alternates)) return group.repeats ? "it repeats a group that repeats or is optional inside (like (a+)+ or (a?a?)+)" : "it repeats a group of alternatives (like (a|aa)+)";
    if (group && !q?.repeats) { /* a group's own atoms are in the run already */ }
    else if (atom && (q?.repeats || q?.optional)) {
      if (run.filter(r => overlap(r, atom)).length > MAX_OVERLAPPING) return "it repeats or makes optional several things side by side that match the same characters (like a*a*a*b)";
      run = [...run, atom];
      top.repeats = true;
    } else if (atom && !group) {
      // A required atom ends the part of every atom it can't match what they match.
      run = run.filter(r => overlap(r, atom));
    }
    if (group) { top.repeats ||= group.repeats; top.alternates ||= group.alternates; }
  }
  return undefined;
}
