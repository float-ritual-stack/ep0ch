---
id: terminal-runbook
---
Try a terminal runbook [type::runbook] [herb::sage]
Run any step by its control. Each gets its own terminal tile and a child run record.

Garden context
cwd:: /tmp
```env
HERB={{self.herb}}
LABEL=The demo garden
```

Print the garden
```sh run
printf '%s: %s\n' "$LABEL" "$HERB"
```

Choose a pot
```sh run
printf 'Planting in %s\n' {{ask.pot}}
```

Check a made-up token
```sh run
test -n {{secret.token}} && printf 'Token received\n'
```

An example (no control)
```sh
printf 'example only\n'
```
