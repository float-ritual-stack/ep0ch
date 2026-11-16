### A failing Jira card reads in Evan's words at any width (PIE-1802)

- **Jira named:** a 500 reads "couldn't fetch: Jira answered 500"; no answer is "Jira didn't answer", a slow one "Jira didn't answer in time". An extension's failure envelope may carry the HTTP `status` with code `http`, and the host words every code with the manifest's name.
- **No internal word:** a card that never fetched heads with "Jira PC-7" alone; the failure line under it says what happened.
- **"R now" stays whole:** the key and its verb are joined by a no-break space, which the wrap holds on one row and draws as a space (every width from 20 to 100 checked). Toasts carry a plain space.
- **Run:** nothing beyond `ep0ch install --apply`; no PROTOCOL, GRAMMAR or schema change.
