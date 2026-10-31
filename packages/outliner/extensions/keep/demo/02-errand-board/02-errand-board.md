Errand board [script::board] [mode::render] [subtitle::lanes of what a query holds] [form-field::where query required] [form-field::group property default=status]
Lanes of what a query holds, one card per note.

::board{where="type=errand" group=status}

```tsx
import { Lane } from "ui-kit"
const { groups } = await query({ where: props.where[0], group: props.group[0] })
return <row>{groups.map(g => <Lane title={g.value ?? "none"} rows={g.rows}/>)}</row>
```
