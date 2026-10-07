// Why a rule's text pattern could take forever on one line, or undefined when it can't. Pure, no I/O.
//
// The service tests every line of every note against a rule's pattern with no deadline, and a JS regex can't be
// interrupted. So a pattern is read structurally (escapes, classes and groups, no regex of regexes) and refused
// when backtracking can blow up: a repeated group holding a repetition or alternatives at any depth (`((a+))+`,
// `(a|aa)*`, `(a{1,9}){1,9}`), a backreference, or a run of repeating atoms with no literal between them (`a*a*a*a*a*b` is
// polynomial, and the line cap makes the exponent matter).

/**
 * At most this many `+`, `*` or `{n,m}` atoms in a row with no literal character between them. The pattern runs
 * from every start of a line, so k in a row cost n^(k+1) steps (`a*a*a*b` on 1000 a's took 15 s): 2 in a row on the
 * line cap is about 10^7. A literal between them (`\s*!!!\s*`) restarts the count.
 */
export const MAX_REPEATING_RUN = 2;

/** An escape class and the one that can't overlap it: `\\s*(\\S…)` splits where the spaces end, so it restarts the run. */
const COMPLEMENT: Record<string, string> = { s: "S", S: "s", d: "D", D: "d", w: "W", W: "w" };

interface Frame { repeats: boolean; alternates: boolean; runBefore: number }

/** The quantifier at `i`: how far it reaches (`end`, past a lazy `?`) and whether it can repeat more than once. */
function quantifierAt(raw: string, i: number): { end: number; repeats: boolean; optional: boolean } | undefined {
  const c = raw[i];
  let end: number, repeats: boolean, optional = false;
  if (c === "+" || c === "*") { end = i + 1; repeats = true; }
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

export function unsafePatternReason(raw: string): string | undefined {
  const stack: Frame[] = [];
  let top: Frame = { repeats: false, alternates: false, runBefore: 0 };
  let run = 0, repeated = "";
  for (let i = 0; i < raw.length;) {
    const c = raw[i]!;
    let group: Frame | undefined, literal = false, escape = "";
    if (c === "\\") {
      if (/^[1-9]|^k</.test(raw.slice(i + 1, i + 3))) return "a backreference (like \\1) can backtrack without bound";
      if (/[dDwWsS]/.test(raw[i + 1] ?? "")) escape = raw[i + 1]!;
      else if (!/[bB]/.test(raw[i + 1] ?? "")) literal = true;
      i += 2;
    } else if (c === "[") {
      i++;
      while (i < raw.length && raw[i] !== "]") i += raw[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "(") {
      stack.push(top);
      top = { repeats: false, alternates: false, runBefore: run };
      i++;
      continue;
    } else if (c === ")") {
      group = top;
      top = stack.pop() ?? { repeats: false, alternates: false, runBefore: 0 };
      i++;
    } else if (c === "|") {
      top.alternates = true;
      i++;
      continue;
    } else {
      literal = c !== ".";
      i++;
    }
    const q = quantifierAt(raw, i);
    if (q) {
      i = q.end;
      if (q.repeats) {
        if (group && (group.repeats || group.alternates)) return group.repeats ? "it repeats a group that repeats (like (a+)+)" : "it repeats a group of alternatives (like (a|aa)+)";
        if (++run > MAX_REPEATING_RUN) return `it repeats ${MAX_REPEATING_RUN + 1} things in a row with nothing between them (like a*a*a*b)`;
        top.repeats = true;
        repeated = escape;
      } else if (escape && !q.optional && COMPLEMENT[escape] === repeated) run = 0;
      else if (group && q.optional) run = group.runBefore;
      else if (literal && !q.optional) run = 0;
    } else if (literal) run = 0;
    else if (escape && COMPLEMENT[escape] === repeated) run = 0;
    if (group) { top.repeats ||= group.repeats; top.alternates ||= group.alternates; }
  }
  return undefined;
}
