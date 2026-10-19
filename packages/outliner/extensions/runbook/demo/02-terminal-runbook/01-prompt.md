---
id: terminal-prompt
---
Answer the gardener
run::
```sh
printf 'Which herb? '
read -r herb
printf 'Planting %s\n' "$herb"
```
