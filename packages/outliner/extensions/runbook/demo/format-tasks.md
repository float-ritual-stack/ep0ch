Format as tasks [script::tasks]
A copyable formatter for `| as tasks`. `props.lines` holds the previous output; `props.cwd[0]` is its folder.

```js
return props.lines.filter(Boolean).map(line => "- [ ] " + line).join("\n");
```
