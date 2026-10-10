Start here: your notifications on two boards
This is the notifications hub's demo, written when it was installed. It's yours now: change it, move it, delete what you don't use.

- Every notification is one note under the [[notifications]] page, with open properties: `notify.source`, `notify.kind`, `notify.from`, `notify.state`, `notify.received`, `notify.url`.
- The two boards below are hubs of views. ((unread|Unread)) and ((read|Read)) split them by `notify.state`; drag a card from one lane to the other to mark it read (the lane's query is the change).
- The second board has a lane per source: ((github|GitHub)), Gmail, Jira and Slack. A source you don't pull is an empty lane: delete it.
- Pull now: `ep0ch ext run notify action:pull`. It also runs every five minutes.
