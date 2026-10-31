Format as files [script::files]
A copyable formatter for `| as files`. `props.lines` holds the previous output; `props.cwd[0]` is its folder.

```js
return props.lines.filter(Boolean).map(line => "- [file::" + (line.startsWith("/") ? line : props.cwd[0] + "/" + line.replace(/^\.\//, "")) + "]").join("\n");
```
