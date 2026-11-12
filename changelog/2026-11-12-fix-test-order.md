### Focused runs have no order or timing flakes (PIE-1774, PIE-1764)

- **A test file's fake action sets end with the file:** the teardown between files drops every action set a test file made itself, so dispatch's fakes no longer show up in action-pages' examples check when garbage collection hasn't run. Built-in sets stay, whichever file imported them first.
- **extension-writes' removed-while-running test waits on the extension:** its slow action says it's running and answers only after the test has disabled or removed it, so a slow bun load can't make it red.
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.
