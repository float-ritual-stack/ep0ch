### Every extension's claude works on the laptop with no setting (PIE-1708)

- **The host hands `claude` its login:** an extension's process (and a script's `sh`) gets `CLAUDE_CODE_OAUTH_TOKEN`: the host's own, else the with-secrets `claude` group's, read at each call and scrubbed from what the process returns. On a host under launchd, which can't read `claude`'s Keychain login, @yo, @tidy, asks and @margin answer with their default settings; no setting names `with-secrets claude --` any more.
- **No login says how to store one:** a `claude` that says "Not logged in" makes yo's steps, tidy's refusal and asks' run say `with-secrets --add claude CLAUDE_CODE_OAUTH_TOKEN` instead of "exited 1".
- **@margin resumes its threads again where it was wrapped:** its `claude` session flags follow a command that starts with `claude`, which a `with-secrets claude --` prefix hid.
- **Run:** `ep0ch install --apply` on each machine (the outline host). Then on the laptop, in float-hub, take the hand-written prefixes out: `ep0ch act ext.tidy.settings unset=answer --as loki`, and marginalia's `answer` set to its words after `with-secrets claude --`. PROTOCOL, GRAMMAR and the schema don't move.
