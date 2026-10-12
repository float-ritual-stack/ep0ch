# Intake (prior art for new requests)

When a request arrives, find what came before it. A rule note sets it off; an agent in the note does the looking;
what it found lands under the request as a note of its own.

```text
Inbox
└─ The hose reel jams again [type::request]            ← a person files it, or an EchoNet copy arrives
   └─ Prior art and related [type::prior-art] [via-trigger::intake-prior-art]
        **In this outline**
        - ((…|The hose reel jams when it's wound fast))
        **In float-hub on macbook**
        - [Hose reel guide arm](ep0ch://float-hub@macbook/b/…)
        Likely duplicate: ((…|The hose reel jams when it's wound fast)) (most of the same words in the title).
        @prior-art what came before ((…|The hose reel jams again))?
```

## The rule note

Intake does nothing on its own. One rule note in the outline says when it runs (PIE-786: rules run actions):

```text
Intake prior art [rule-name::intake-prior-art] [rule-match::type=request] [rule-under::((<inbox>))] [rule-on::intake/prior-art] [rule-from::user, agent, ext:echonet] [rule-batch::1m] [rule-cap::20/day] [rule-skip::triage=done OR child:type=prior-art]
```

- `rule-on::intake/prior-art`: runs when a block **starts** matching (a new request), never on later edits.
- `rule-from`: whose saves set it off. A person's and agents' by default; `ext:echonet` adds EchoNet copies arriving.
  Nothing a trigger wrote sets it off again, here or in another outline (its notes carry `[via-trigger::…]`).
- `rule-batch::1m`: a burst (a toss's arrivals) is one call, every request in it at once.
- `rule-cap::20/day`: the most calls a day, each of which may start an agent. Past it, the rule says so in
  `extensions.list` (`lastRun`) and runs again tomorrow.
- `rule-skip`: a request marked handled, or one that has its prior art already, never sets it off. The note carries
  `[type::prior-art]`, so `child:type=prior-art` finds it however it was made (the trigger's own mark,
  `child:via-trigger=intake-prior-art`, works too, for notes the rule made).

The door's settings card (`,` on the rule note) sets each of these with a picker.

## What it does

- **`prior-art`** (an action on a block): under each request, "Prior art and related [type::prior-art]", unless
  one is there already.
  - **Run by a rule**, the note asks `@prior-art`, this extension's own agent, and the service asks it at once. Only a
    trigger's new note may ask an agent, and only its own extension's.
  - **Run by hand** (the action's key or `ep0ch act`), it looks now, without a model, and the list is the note.
- **`@prior-art`** (an agent, `effects: spend`): searches this outline, each outline in `config.outlines` and
  `config.archive`, for the request's words, and puts the list where the note's "Looking in …" line was. With
  `config.answer` a model writes the closing line (which look like duplicates, what to build on); without, the line
  comes from how alike the titles are, and says so.

## Config (`config.json` in the folder)

```json
{
  "config": {
    "outlines": [{ "outline": "float-hub", "machine": "macbook" }],
    "archive": ["ssh", "float-box", "rg", "-l", "-i", "-m1", "{word}", "/srv/archive/notes"],
    "answer": ["claude", "-p"],
    "limit": 6
  }
}
```

- `outlines`: other outlines, by name, and `machine` (an ssh config name) for one on another machine. Each is read
  as far as its access level lets Intake (PIE-779); one it can't reach says why in the note.
- `archive`: a command; `{word}` is the request's most telling word (letters, digits and `-`, so it stays one
  argument through ssh), every word is on its stdin, and each line it prints is a hit. Exit 1 with nothing printed is
  no hits; any other failure is said in the note. It runs on this machine.
- `answer`: a command that reads the request and the list on stdin and prints the closing words.

## The demo

Installing Intake puts **Intake demo** under its page: earlier notes to find, a demo rule note scoped to a demo inbox,
and the inbox with a request already handled. File a request under the inbox (`The hose reel jams again
[type::request]`) and watch its prior art arrive.
