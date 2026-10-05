# Triage Labels

The skills use five triage roles. The outline has no labels. A role is the value of the item's `triage`
property (`[triage::ready-for-agent]`), set with `work_set <PIE-n> triage <value>` and found with
`outline_find` `query: "type=roadmap-item AND triage=<value>"`. The property is single-valued, so a new role
replaces the old one.

| Label in mattpocock/skills | Label in our tracker      | Meaning                                  |
| -------------------------- | ------------------------- | ---------------------------------------- |
| `needs-triage`             | `triage::needs-triage`    | Maintainer needs to evaluate this issue  |
| `needs-info`               | `triage::needs-info`      | Waiting on reporter for more information |
| `ready-for-agent`          | `triage::ready-for-agent` | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `triage::ready-for-human` | Requires human implementation            |
| `wontfix`                  | `triage::wontfix`         | Will not be actioned                     |

A role is never the item's stage. `ready-for-agent` doesn't queue or commit an item. It stays
`unprioritized` until Evan selects it into a batch (see the workboard contract). For `wontfix`, also
`work_stage` it to `later` with the reason in a comment. If a replacement exists, use `superseded` with
`superseded-by`. An item with no `triage` property and stage `unprioritized` counts as `needs-triage`.
