Format as list [script::list]
A copyable formatter for `| as list`. `props.lines` holds the previous output; `props.cwd[0]` is its folder.

```js
return props.lines.filter(Boolean).map(line => "- " + line).join("\n");
```
