// ep0ch-script effects=write
// [form-field::name text required]: the component's name, lower case and hyphens (open-count); its note is titled from it
// Keeps a `::=` line as a named component: a child note `[script::<name>] [mode::render]` holding the expression, and the
// line rewritten to `::<name>{}`. Which line: the one it was run from (`act ext.script:keep.run line=`), else `line=` as
// a line number (1 is the first) or the line's text, else the note's first `::=` line. One run, so one undo takes both back.
const name = (props.name?.[0] ?? '').trim();
if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw new Error(`keep needs name=: lower case letters, digits and hyphens, starting with a letter (open-count)${name ? `; ${name} isn't one` : ''}`);
const taken = (await q(`script=${name}`, { limit: 1 })).blocks[0];
if (taken) throw new Error(`${name} is taken: ((${taken.id})) is [script::${name}]; pick another name`);
// A built-in's id (::table would draw the table, not this) or a name a folder's script or an extension has.
const owner = (await components()).find(c => c.name === name);
if (owner) throw new Error(`${name} is taken: ${owner.origin} has it; pick another name`);

const host = await tools.outline_read({ ref: this.id, depth: 0 });
const lines = host.text.split('\n');
const PIPE = /^([ \t]*(?:[-*+][ \t]+)?)::=[ \t]*(\S.*?)[ \t]*$/;
// Lines inside a code fence are code, never a `::=` line.
const inFence = [];
let fence = null;
for (const line of lines) {
  const open = /^\s*(`{3,}|~{3,})/.exec(line);
  inFence.push(fence !== null || !!open);
  if (open && fence === null) fence = open[1];
  else if (open && fence !== null && open[1][0] === fence[0] && open[1].length >= fence.length && !line.trim().slice(open[1].length)) fence = null;
}
const isPipe = (i) => i >= 0 && i < lines.length && !inFence[i] && PIPE.test(lines[i]);
const asked = props.line?.[0]?.trim();
let at = -1;
if (caller && caller.block === this.id && caller.line !== undefined && isPipe(caller.line)) at = caller.line;
else if (asked && /^\d+$/.test(asked)) at = Number(asked) - 1;
else if (asked) at = lines.findIndex((line, i) => isPipe(i) && line.trim() === asked);
else at = lines.findIndex((_, i) => isPipe(i));
if (!isPipe(at)) throw new Error(asked ? `line ${asked} isn't a ::= line in ${host.title || 'this note'}` : `${host.title || 'this note'} has no ::= line to keep`);

const [, lead, expression] = PIPE.exec(lines[at]);
// Each `props.x` the expression reads becomes a slot the component takes, as text.
const slots = [];
for (const m of expression.matchAll(/\bprops\.([a-z][a-z0-9_]*)|\bprops\[["']([a-z][a-z0-9_-]*)["']\]/g)) {
  const slot = m[1] ?? m[2];
  if (!slots.includes(slot)) slots.push(slot);
}
const title = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');
const note = [
  `${title} [script::${name}] [mode::render]${slots.map(s => ` [form-field::${s} text]`).join('')}`,
  `Kept from a ::= line in ((${this.id})).`,
  '',
  `::${name}{}`,
  '',
  '```tsx',
  `return (${expression});`,
  '```',
].join('\n');

// The line first, at the revision read: a note changed since refuses it, and nothing is made.
const start = lines.slice(0, at).reduce((n, line) => n + line.length + 1, 0) + lead.length;
const observed = lines[at].slice(lead.length);
const patched = await tools.outline_patch({ ref: this.id, revision: host.revision, patches: [{ observed, replacement: `::${name}{}`, range: { start, end: start + observed.length } }] });
const made = await tools.outline_create({ parent: this.id, text: note });
const proposed = patched && patched.outcome === 'proposed';
return proposed
  ? `kept ::${name} in ((${made.id})); the line waits as a proposal (you were typing there)`
  : `kept ::${name}: line ${at + 1} is ::${name}{}, its code in ((${made.id}))`;
