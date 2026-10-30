Pull GH errands [script::gh-errands] [effects::write]
Each open GitHub issue of the repo you run it in becomes an errand under Errands. It runs `gh` as you; the run note shows the command and what it answered.

```ts
const out = await sh(["gh", "issue", "list", "--json", "number,title", "--limit", "20"])
if (out.exit !== 0) return `gh answered ${out.exit}: ${out.stderr.split("\n")[0]}`
for (const i of JSON.parse(out.stdout))
  await tools.outline_create({ parent: "[[keep-errands]]", text: `${i.title} [type::errand] [status::open] [gh::${i.number}]` })
```
