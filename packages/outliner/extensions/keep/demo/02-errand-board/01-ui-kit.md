UI kit [script::ui-kit] [mode::module]
Pieces the board imports by name. A module is never run or called by itself.

```tsx
const Lane = ({ title, rows }) =>
  <box title={`${title} · ${rows.length}`}>
    {rows.map(r => <card title={r.title} subtitle={r.props.owner?.[0] ?? ""} act={`errand-done note=${r.id}`}/>)}
  </box>
return { Lane }
```
