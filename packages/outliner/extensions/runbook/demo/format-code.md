Format as code [script::code]
A copyable formatter for `| as code`. `props.lines` holds the previous output; `props.cwd[0]` is its folder.

```js
const fence = "`".repeat(Math.max(3, ...props.lines.flatMap(line => [...line.matchAll(/`+/g)].map(m => m[0].length + 1))));
return fence + "text\n" + props.lines.join("\n") + "\n" + fence;
```
