### Every Herdr console scenario runs green, and the five console bugs they found are fixed (PIE-1698)

- **Keys typed right after `?` reach Detail's menu:** typing "detail chrome" straight after `?` no longer lands in the note, where `D` resolved a comment and `e` opened the editor.
- **Detail's footer starts with the keys for what you're doing:** with a Preview open beside a narrow Detail, the Current/Preview hints had pushed `⌃S save` off the editor's footer.
- **A drag in Current copies and comments with a Preview open beside it:** Detail's layout pass measures the note without replacing the render on screen. Before, it replaced it, and the drag was refused with "The selected passage could not be captured".
- **An open aimed at Current leaves your keys in the Preview's comment draft,** so the words you're typing don't go to Current.
- **A view's `[expand-when::…]` opens the Comments group of the comment it matched,** once. Collapsing that group afterwards sticks.
- **The scenarios follow the console as shipped:** compact chrome, fixtures in the outline's own folder, the outline named `project`, Tab order, Preview comments and the current labels. Each change cites the commit that made it. The harness runs under the short scratch root (`/tmp/ep0ch-<uid>`).
- **Run:** `ep0ch install --apply`. PROTOCOL, GRAMMAR and the schema don't move.
