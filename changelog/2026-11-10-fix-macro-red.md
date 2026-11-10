### Main's macro test is green again (PIE-1717)

- **A recorded macro still runs whole:** it never stopped. The red step was the test's own tidy-up after the replay, a `comment.close` with no comment open, which refuses since PIE-1701. The test now checks the replay left nothing open and the comment is there twice, recorded and replayed.
- **An esc-close in a recording replays:** walked on a scratch showcase door, a recording of `m` then esc saves `threads` then `comment.close`, and both replay. The recorder keeps only steps that succeeded, so a macro holds a close only after it opened what it closes.
- **Run:** nothing to deploy (a test change). PROTOCOL, GRAMMAR and the schema don't move.
