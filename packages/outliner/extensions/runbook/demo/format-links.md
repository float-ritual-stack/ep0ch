Format as links [script::links]
A copyable formatter for `| as links`. `props.lines` holds the previous output; `props.cwd[0]` is its folder.

```js
return props.lines.map(line => "- [[" + line + "]]").join("\n");
```
