Format as code [script::code]
A copyable formatter for `| as code`. `props.lines` holds the previous output; `props.cwd[0]` is its folder.

```js
const lines = props.lines.filter(Boolean);
if (!lines.length) return "";
const fence = "`".repeat(Math.max(3, ...lines.flatMap(line => [...line.matchAll(/`+/g)].map(m => m[0].length + 1))));
return fence + "text\n" + lines.join("\n") + "\n" + fence;
```
