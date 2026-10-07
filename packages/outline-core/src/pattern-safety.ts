// Why a rule's text pattern could take forever on one line, or undefined when it can't. Pure, no I/O.
//
// The service tests every line of every note against a rule's pattern with no deadline, and a JS regex can't be
// interrupted. So a pattern is read structurally (escapes, classes and groups, no regex of regexes) and refused
// when backtracking can blow up:
//   - a repeated group that holds a repetition, an optional atom or alternatives at any depth (`((a+))+`, `(a|aa)*`,
//     `(a?a?)+`, `(a{1,9}){1,9}`), and any backreference;
//   - a run of repeating atoms with nothing between them that can't overlap them. The pattern runs from every start
//     of a line, so k in a row cost n^(k+1) steps (`a*a*a*b` on 1000 a's took 15 s). A literal or a class that can't
//     match what the run repeats (`\s*!!!\s*`, `\s*(\S…)`) ends the run; `a*aa*aa*b` doesn't.

/** At most this many repeating atoms in a run: 2 on the line cap is about 10^7 steps. */
export const MAX_REPEATING_RUN = 2;

/** Whether an atom can match a character; a group or anything we can't read matches anything. */
type Overlap = (ch: string) => boolean;
const ANY: Overlap = () => true;

interface Frame {
  /** Whether the group so far holds a repeating or optional atom, or alternatives. */
  repeats: boolean;
  alternates: boolean;
  /** The run on entry, and the longest run any branch of the group reached. */
  before: Overlap[];
  longest: Overlap[];
}

/** The quantifier at `i`: how far it reaches (past a lazy `?`), whether it repeats and whether it is optional. */
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

function escapeOverlap(letter: string): Overlap | undefined {
  if (/[dDwWsS]/.test(letter)) return ch => new RegExp(`\\${letter}`, "u").test(ch);
  if (/[bB]/.test(letter)) return undefined;
  return ch => ch === letter;
}

function classOverlap(source: string): Overlap {
  try {
    const re = new RegExp(source, "u");
    return ch => re.test(ch);
  } catch { return ANY; }
}

export function unsafePatternReason(raw: string): string | undefined {
  const fresh = (before: Overlap[]): Frame => ({ repeats: false, alternates: false, before, longest: before });
  const stack: Frame[] = [];
  let top = fresh([]);
  /** The repeating atoms of the current run, each as what it can match. */
  let run: Overlap[] = [];
  for (let i = 0; i < raw.length;) {
    const c = raw[i]!;
    let group: Frame | undefined;
    /** What the atom just read can match, and the single character it is when it is a plain literal. */
    let atom: Overlap | undefined = ANY, literal: string | undefined;
    if (c === "\\") {
      if (/^[1-9]|^k</.test(raw.slice(i + 1, i + 3))) return "a backreference (like \\1) can backtrack without bound";
      atom = escapeOverlap(raw[i + 1] ?? "");
      if (atom && !/[dDwWsS]/.test(raw[i + 1] ?? "")) literal = raw[i + 1];
      i += 2;
    } else if (c === "[") {
      const start = i++;
      while (i < raw.length && raw[i] !== "]") i += raw[i] === "\\" ? 2 : 1;
      i++;
      atom = classOverlap(raw.slice(start, i));
    } else if (c === "(") {
      stack.push(top);
      top = fresh(run);
      i += 1 + (/^\?(?:[:=!]|<[=!]|<[A-Za-z_]\w*>)/.exec(raw.slice(i + 1))?.[0].length ?? 0);
      continue;
    } else if (c === ")") {
      group = top;
      if (group.longest.length > run.length) run = group.longest;
      top = stack.pop() ?? fresh([]);
      i++;
    } else if (c === "|") {
      top.alternates = true;
      if (run.length > top.longest.length) top.longest = run;
      run = top.before;
      i++;
      continue;
    } else {
      if (c !== ".") literal = c;
      else atom = ANY;
      i++;
    }
    if (literal !== undefined) { const lit = literal; atom = ch => ch === lit; }
    const q = quantifierAt(raw, i);
    if (q) {
      i = q.end;
      if (q.repeats) {
        if (group && (group.repeats || group.alternates)) return group.repeats ? "it repeats a group that repeats or is optional inside (like (a+)+ or (a?a?)+)" : "it repeats a group of alternatives (like (a|aa)+)";
        run = [...(group ? group.before : run), group ? ANY : atom ?? ANY];
        if (run.length > MAX_REPEATING_RUN) return `it repeats ${MAX_REPEATING_RUN + 1} things in a row with nothing between them (like a*a*a*b)`;
        top.repeats = true;
      } else if (q.optional) {
        if (group) run = group.before;
        top.repeats = true;
      } else if (literal !== undefined || group) run = endsRun(run, atom, group);
    } else if (!group) run = endsRun(run, atom, group);
    if (group) { top.repeats ||= group.repeats; top.alternates ||= group.alternates; }
  }
  return undefined;
}

/**
 * A required atom drops from the run every repeating atom that can't match what it matches (`a*xa*` splits at x;
 * `.*\\s*!!!` leaves the `.*`): probe with the characters a pattern can tell apart.
 */
function endsRun(run: Overlap[], atom: Overlap | undefined, group: Frame | undefined): Overlap[] {
  if (group || !atom) return run;
  const probes = "a0 _!.-:/".split("");
  return run.filter(r => probes.some(p => atom(p) && r(p)));
}
