# Intake

When a request arrives, Intake writes what your outlines already hold on it under the request, and flags a likely duplicate.

## Where to look

- **Intake demo:** under the extension's page, with earlier notes to find, a demo rule and an inbox.
- **Under each request:** a "Prior art and related" note, once Intake has looked.

```text
Inbox
└─ The hose reel jams again [type::request]            ← a person files it, or an EchoNet copy arrives
   └─ Prior art and related [type::prior-art] [via-trigger::intake-prior-art]
        **In this outline**
        - ((…|The hose reel jams when it's wound fast))
        **In float-hub on macbook**
        - [Hose reel guide arm](ep0ch://float-hub@macbook/b/…)
        Likely duplicate: ((…|The hose reel jams when it's wound fast)) (most of the same words in the title).
```

## What you do

- **File a request:** write `The hose reel jams again [type::request]` under the demo inbox and its prior art arrives.
- **Look now:** run the `prior-art` action on a request (its key, or `ep0ch act`).
  - It searches at once, without a model, and the list is the note.
- **Ask in a note:** write `@prior-art what came before ((…|the request))?` under a request.
- **Set the rule:** press `,` on the rule note; each setting below has a picker.

## Setup

- **Install:** `ep0ch ext add intake`.
- **Turn it on:** Intake does nothing on its own until a rule note says when it runs (PIE-786).
- **Settings:** `config.json` in the extension's folder, all optional:

```json
{
  "config": {
    "outlines": [{ "outline": "float-hub", "machine": "macbook" }],
    "archive": ["ssh", "float-box", "rg", "-l", "-i", "-m1", "%word%", "/srv/archive/notes"],
    "answer": ["claude", "-p"],
    "limit": 6
  }
}
```

- **`outlines`:** other outlines to search, by name, plus `machine` (an ssh config name) for one elsewhere.
  - Each is read as far as its access level lets Intake (PIE-779); one it can't reach says why in the note.
- **`archive`:** a command that searches an archive, run on this machine.
  - `%word%` is the request's most telling word (letters, digits and `-`).
  - Every word is on its stdin, and each line it prints is a hit.
  - Exit 1 with nothing printed is no hits; any other failure is said in the note.
- **`answer`:** a command that reads the request and the list on stdin and prints the closing words.
  - Without it, the closing line comes from how alike the titles are, and says so.
- **`limit`:** the most hits from each place (6).

## How it works

- **The rule note:** one note in the outline sets Intake off.

```text
Intake prior art [rule-name::intake-prior-art] [rule-match::type=request] [rule-under::((<inbox>))] [rule-on::intake/prior-art] [rule-from::user, agent, ext:echonet] [rule-batch::1m] [rule-cap::20/day] [rule-skip::triage=done OR child:type=prior-art]
```

- **`rule-on::intake/prior-art`:** runs when a block starts matching (a new request), never on later edits.
- **`rule-from`:** whose saves set it off.
  - A person's and agents' by default; `ext:echonet` adds EchoNet copies arriving.
  - Nothing a trigger wrote sets it off again, here or in another outline.
- **`rule-batch::1m`:** a burst, such as a toss's arrivals, is one call with every request in it.
- **`rule-cap::20/day`:** the most calls a day, each of which may start an agent.
  - Past it, `extensions.list` says so (`lastRun`) and the rule runs again tomorrow.
- **`rule-skip`:** a request marked handled, or one with its prior art already, never sets it off.
  - `child:type=prior-art` finds that note however it was made.
- **By a rule:** the note asks `@prior-art`, this extension's own agent, and the service asks it at once.
  - Only a trigger's new note may ask an agent, and only its own extension's.
- **`@prior-art`:** an agent (`effects: spend`) that searches this outline, each outline in `config.outlines` and the `config.archive`.
  - It puts the list where the note's "Looking in …" line was.
  - With `config.answer` a model writes the closing line: which look like duplicates, what to build on.
