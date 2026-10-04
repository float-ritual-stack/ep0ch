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
import { allActionSets } from "../surface/actions";
import { BOLD, ellipsize, fg, RESET, UNBOLD, width as vwidth } from "../style";
import { wrap } from "../text";
import type { Markdown } from "./markdown";
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

/** `- ctrl+k: what it does`; bold learns first. */
export function keysMarkdown(md: Markdown): Props {
  const rows = md.rows.filter(r => r.label !== null);
  return rows.length ? { keys: rows.map(r => ({ keys: r.label, action: r.value, learn: r.emphasis === "strong", block: r.block })) } : {};
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
