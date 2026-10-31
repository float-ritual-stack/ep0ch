Format as table [script::table]
A copyable formatter for `| as table`. `props.lines` holds the previous output; `props.cwd[0]` is its folder.

```js
const rows = props.lines.filter(Boolean).map(line => line.trim().split(/\s+/));
if (!rows.length) return "";
const columns = Math.max(...rows.map(row => row.length));
const row = cells => "| " + Array.from({length: columns}, (_, i) => (cells[i] || "").replace(/\|/g, "\\|")).join(" | ") + " |";
return [row(rows[0]), row(Array(columns).fill("---")), ...rows.slice(1).map(row)].join("\n");
```
