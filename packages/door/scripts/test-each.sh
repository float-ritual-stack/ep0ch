#!/bin/sh
# Each test file alone, in its own process, one after another: a file that only passes because another file loaded
# a module first (an import cycle, a shared global) fails here. `bun test` loads every file into one process, which
# hides that: #204's cycle left 13 files unable to load alone for a day. Parity and showcase files are slow; pass
# file names to run only those. Prints only the files that fail, then exits 1 if any did.
cd "$(dirname "$0")/.." || exit 2
files=${*:-$(ls test/*.test.ts)}
bad=0
for f in $files; do
  out=$(timeout 900 bun test "$f" 2>&1)
  if ! printf '%s' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -qE '^ 0 fail$'; then
    echo "✗ $f"; printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^(error|✗)|Error:' | head -5; bad=1
  fi
done
exit $bad
