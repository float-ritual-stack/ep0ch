#!/bin/sh
# Each test file alone, in its own process: a file that only passes because another file loaded a module first (an
# import cycle, a shared global) fails here. `bun test` loads every file into one process, which hides that: #204's
# cycle left 13 files unable to load alone for a day. Parity and showcase files are slow; pass file names to run
# only those. TEST_EACH_JOBS runs that many at once (default 1: one after another; scripts/box-test runs one per
# vCPU in a boxd box). Prints only the files that fail, then exits 1 if any did.
cd "$(dirname "$0")/.." || exit 2
if [ "$1" = --one ]; then
  out=$(timeout 900 bun test "$2" 2>&1)
  printf '%s' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -qE '^ 0 fail$' && exit 0
  # One printf, so files running at once don't interleave their lines.
  printf '✗ %s\n%s\n' "$2" "$(printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^(error|✗)|Error:' | head -5)"
  exit 1
fi
files=${*:-$(ls test/*.test.ts)}
printf '%s\n' $files | xargs -P "${TEST_EACH_JOBS:-1}" -n 1 sh "$0" --one || exit 1
