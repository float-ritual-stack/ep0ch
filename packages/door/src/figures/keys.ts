// `::graph-keys`: a keymap cheat sheet, each key drawn as keycaps (`ctrl+k` is [ctrl][k], `g then d` is [g] then
// [d]); a bold row is one to learn first. Or `actions: <scope>`: the door's own keys, read from the action registry
// (src/surface/actions.ts), the one place every key is declared, so the sheet never drifts from what the keys do.
//
//   ::graph-keys                          ::graph-keys
//   ---                                   ---
//   title: the reader                     title: the reader's keys (from the door)
//   ---                                   actions: note               (a scope, or a list of them)
//   - **e: edit the note**                learn: [edit, comment.start] (names drawn as learn-first)
//   - g then d: the desk                  limit: 12
//   - ctrl+k: the command palette         ---
//   ::                                    ::
import { allActionSets, isKeyWord } from "../surface/actions";
import { BOLD, ellipsize, fg, RESET, UNBOLD, width as vwidth } from "../style";
import { wrap } from "../text";
import { ACCENT, DIM, HI, INK, rowLink, type Props, type RowLink } from "./palette";

/** A key as written (`ctrl+k`, `g then d`, `( ) or f`) drawn as keycaps, its joining words dim. */
export function keycaps(spec: string, learn = false): string {
  const cap = learn ? fg(ACCENT) : fg(HI);
  return spec.trim().split(/\s+/).map(word => {
    if (/^(then|or|and|,)$/.test(word)) return fg(DIM) + word;
    // `ctrl++` is ctrl and +; `+` alone is the key.
    const parts = word.length > 1 ? word.split(/\+(?!$)/) : [word];
    return parts.map(k => fg(DIM) + "[" + cap + k + fg(DIM) + "]").join("");
  }).join(" ") + RESET;
}

export function drawKeys(p: Props, w: number, link?: RowLink): string[] {
  const keys: Props[] = p.keys ?? [];
  if (!keys.length && p.actions) return [fg(DIM) + `no action in ${[p.actions].flat().join(", ")} declares a key here` + RESET];
  const drawn: Props[] = keys.map(k => ({ ...k, caps: keycaps(String(k.keys ?? ""), !!k.learn) }));
  const kw = Math.min(Math.max(0, ...drawn.map(k => vwidth(k.caps))), Math.floor(w * 0.55));
  const out: string[] = [];
  for (const k of drawn) {
    const caps = vwidth(k.caps) > kw ? ellipsize(k.caps, kw) + RESET : k.caps;
    const lines = wrap(String(k.action ?? ""), Math.max(6, w - kw - 2));
    lines.forEach((l, i) => {
      const text = (k.learn ? fg(HI) + BOLD : fg(INK)) + (i ? l : rowLink(link, k.block, l)) + UNBOLD + RESET;
      out.push((i ? " ".repeat(kw) : caps + " ".repeat(Math.max(0, kw - vwidth(caps)))) + "  " + text);
    });
  }
  return out;
}


/** Words that say a key isn't a key (a click, a drag): such alternatives stay out of a cheat sheet. */
const NOT_A_KEY = /click|drag|wheel|typing|swipe|button|while|outside|\(on /i;

/**
 * The keys the registry's actions declare in `scopes` (`note`, `desk`, …): each action's first alternative that is a
 * key (`e, ctrl+e` gives `e`), and what it does (its summary to the first `;` or `(`). `learn`: action names drawn bold.
 */
export function registryKeys(scopes: readonly string[], learn: readonly string[] = [], limit = 40): Props[] {
  const out: Props[] = [];
  const seen = new Set<string>();
  for (const set of allActionSets().filter(s => scopes.includes(s.scope))) {
    for (const a of set.list()) {
      const key = (a.keys ?? "").split(/[,;]\s*/).map(k => k.trim()).find(k => k && !NOT_A_KEY.test(k) && k.length <= 18);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const what = a.summary.split(/[;(]/)[0]!.trim().replace(/[.:,]$/, "");
      out.push({ keys: key, action: what, learn: learn.includes(a.name) || learn.includes(`${a.scope}.${a.name}`) });
    }
  }
  // Learn-first rows lead; the rest keep the registry's order.
  return [...out.filter(k => k.learn), ...out.filter(k => !k.learn)].slice(0, Math.max(1, limit));
}

/** A keys figure's props with `actions:` answered from the registry (`keys:` written out wins). */
export function keysFromRegistry(p: Props): Props {
  if (!p.actions || p.keys) return p;
  return { ...p, keys: registryKeys([p.actions].flat().map(String), [p.learn ?? []].flat().map(String), Number(p.limit) || 40) };
}

/** A mouse gesture leading an alternative (`a double click on …`, `drag a header`): the gesture its keycap shows. */
const GESTURE = /^(?:or\s+)?(?:an?\s+)?((?:double[ -]|second[ -]|alt-|ctrl-|right-|shift-)?(?:click|drag|wheel|paste|swipe))(?:es|s)?\b\s*(.*)$/i;
/** English that starts like a key (`a click`, `a paste`): one letter is a key only when what follows isn't prose. */
const ARTICLE = /^(a|an|the|or|and|on|in|of|to|by)$/;
/** An alternative that only qualifies the one before it (`on every screen (not while typing)`). */
const QUALIFIER = /^(on|in|while|not|with|everywhere|anywhere|also)\b/;
/** A key word, a hyper chord (`✦p`) among them. */
const keyWord = (w: string) => /^✦\S$/u.test(w) || isKeyWord(w);

/** `text` split at its commas, semicolons and ` · ` outside brackets: one alternative each. */
function alternatives(text: string): string[] {
  const out: string[] = [];
  let depth = 0, at = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth) depth--;
    else if (!depth && (((c === "," || c === ";") && text[i + 1] === " " && i > at) || (c === "·" && text[i - 1] === " " && text[i + 1] === " "))) {
      out.push(text.slice(at, i)); at = i + 1;
    }
  }
  out.push(text.slice(at));
  return out.map(a => a.trim().replace(/^(?:or|and)\s+/, "")).filter(Boolean);
}

/**
 * Every way an action's `keys` says to do it (PIE-1032), as a key sheet's rows: each alternative's keys (`^W m then h j
 * k l`) drawn as keycaps and what it says after them (`beside`), a mouse alternative under its gesture (`click`,
 * `drag`), and one that names no key (`the tile menu's …`) after a dim `or`. `registryKeys` takes the first key only;
 * an action's page lists them all.
 */
export function keyAlternatives(text: string | undefined): { keys: string; action: string }[] {
  const rows: { keys: string; action: string }[] = [];
  const said = (t: string) => t.trim().replace(/^\((.*)\)$/s, "$1").replace(/ — /g, ", ").trim();
  for (const alt of alternatives(text ?? "")) {
    const words = alt.split(/\s+/);
    let n = 0;
    while (n < words.length) {
      const w = words[n]!.replace(/[:]$/, ""), next = words[n + 1];
      if ((w === "then" || w === "or" || w === "and") && n > 0 && next && keyWord(next) && !ARTICLE.test(next)) { n++; continue; }
      // One letter followed by prose that isn't a key (`a click outside it`) is English.
      if (ARTICLE.test(w) || !keyWord(w)) break;
      n++;
    }
    const gesture = !n ? GESTURE.exec(alt) : null;
    if (n) rows.push({ keys: words.slice(0, n).join(" "), action: said(words.slice(n).join(" ")) });
    else if (QUALIFIER.test(alt) && rows.length) { const last = rows.at(-1)!; last.action = [last.action, said(alt)].filter(Boolean).join(", "); }
    else if (gesture) rows.push({ keys: gesture[1]!.replace(/\s+/g, "-").toLowerCase(), action: said(gesture[2]!) });
    else rows.push({ keys: "or", action: said(alt) });
  }
  return rows.filter((r, i) => rows.findIndex(x => x.keys === r.keys && x.action === r.action) === i);
}
