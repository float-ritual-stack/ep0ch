# The Trail needs an extension event path (PIE-1234)

Build paused at the brief's explicit protocol stop condition, on base
`cb135556159a9f570109d8ceae7b3a8d6b2036d1`. This is an investigation and a red
acceptance probe, not the Trail implementation. PROTOCOL 301, GRAMMAR 25 and
SCHEMA 8 are unchanged.

## What exists

- Door placement lands at `Desk.applyPlacement` in
  [desk.ts](../packages/door/src/desk/desk.ts), with the `open.land` probe.
  `surface/dispatch.ts` owns dispatch and attribution; it is not the landing owner.
- The door already has a local `App.subscribe` feed in
  [app.ts](../packages/door/src/app.ts), transported by
  [control.ts](../packages/door/src/control.ts). Its `ViewEvent` allows arbitrary
  event fields. Adding a local `door.open` event there alone would not require a
  service protocol change.
- PIE-754's [extension contract](../packages/outliner/docs/extensions/README.md#extensions-as-programs)
  supplies schedules and one-request service connections. It does not supply a
  door-event subscription. `server.ts`'s `asExtension`, `EXTENSION_READS` and
  `READ_ONLY_ACTIONS` refuse `events.subscribe` over an extension's connection.
- [Extension rules](../packages/outliner/src/extension-manifest.ts) react through
  `on.start`, `on.stop` and `on.change` to matching notes. There is no open-event
  trigger. The service's [OutlinerEvent](../packages/outliner/src/types.ts) has no
  door-open envelope, and no request currently carries that envelope from a door.

## The boundary that needs to change

The complete requirement includes scripts, extensions and rules hearing the
same event through their existing host contract, including when the door and
outline host are on different machines. A local door feed does not provide that
host delivery. Polling `door.opens` or writing opens into notes would change the
requested behavior and storage model.

The service therefore needs a typed ingress for the door's open envelope and
delivery into its extension/script/rule runtime. That adds wire actions or
fields and meanings; [protocol.ts](../packages/outline-core/src/protocol.ts)
explicitly assigns those changes to PROTOCOL. The brief says to stop and report
this in the PR instead of bumping. No number or new transport was chosen here.

## Reproduction

The added case in
[extension-programs.test.ts](../packages/outliner/test/extension-programs.test.ts)
uses its existing real SQLite host and installed subprocess extension. The
extension sends the existing `events.subscribe` request with its own grant. It
expects admission, the first prerequisite for receiving events over that path.

```sh
scripts/agent-env trail --test -- nice -n 15 timeout 1200 bun test packages/outliner/test/extension-programs.test.ts -t 'PIE-1234 probe'
```

Exit **1**, with the intended failure:

```text
Expected: "subscribed"
Received: "ext:trail-probe can read, create, update, move, trash, comment and annotate over its connection; events.subscribe isn't one of them"
```

This probe establishes the missing admission path only. It does not prove event
delivery, nonblocking emission, attribution, or the eventual subscription
lifecycle. It remains red in the draft so this is not mistaken for a passing gate.

## Work still required

After the protocol boundary is resolved, build the full experience in this same
PR: one landing event; one visit subscriber; per-outline state and dwell;
the existing Trail tile extended with the forest and actions; extension delivery;
and the two showcase journeys. Keep `Pane.trail`, navigation history and layout
undo independent. No production Trail behavior, changelog entry or shipped
status is claimed by this investigation. The capability remains building.

The brief's `packages/door/test/showcase/events.test.ts` and
`packages/outliner/test/extension-events.test.ts` do not exist at this base.
The Trail showcase test does exist. The missing tests must be added with their
corresponding event behavior; they are not silently omitted from a green gate.
