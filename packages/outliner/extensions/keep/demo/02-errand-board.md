Errand board: a component from notes
The notes under this one make a component you call by name. The line below draws lanes of errands, one per status.

::board{where="type=errand" group=status}

- **Try a prop:** change `group=status` to `group=owner`; inside `where="` the query grammar completes.
- **Press a card:** it runs **Errand done** on that errand, and the card moves lanes; one undo takes it back.
- **Edit an import:** change `Lane`'s title in **UI kit**, and every board redraws.
- **Reach:** run `gh-errands` from the power bar to pull GitHub issues in as errands (it runs `gh` as you).
