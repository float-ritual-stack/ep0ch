---
description: Send a message to another Claude session as yourself, prefixed [sysop] unless it starts with a [tag] of its own
argument-hint: <name> <text>
---

Send a message to another Claude session for me: $ARGUMENTS

The first word is the session's name, as ListAgents lists it; the rest is the message. Send it with SendMessage, word for word, with `[sysop] ` put before it, unless the message already starts with a `[tag]` of its own (then send it as it is). If the name matches no session or several, or no message follows the name, send nothing and say so. Then say in one line whether it was delivered.
