---
paths:
  - "packages/door/src/setup/install-backups.ts"
  - "packages/door/scripts/backup/**"
commands:
  - '\bssh\b(\s+-\S+(\s+[^-\s]\S*)?)*\s+(\S+@)?float-2\b[\s\S]*\b(df|du|rm|mv|rsync|truncate|offload|journalctl|find)\b'
---

# Disk space on a machine: read the hub before you move or delete anything

The infrastructure hub's "Disk space on float-2" section is the policy, and it changes: read it live first
(`ep0ch show --ws pie --machine float-2 50fe932d-4314-4c1b-88c9-13e79a41ef83`), and update it in the same step when
what you do changes it. On Nov 12 an agent skipped this and had Evan move files by hand to the wrong place.

- **Which disk is full decides what helps.** `df -h /` and `df -h /mnt/HC_Volume_107103370` are different
  filesystems: freeing one never frees the other. Say which one a command frees before you ask for it.
- **Cold things go to the storage box through `offload`** (it copies, checks by checksum, removes, and leaves a
  `.offloaded` note with the way back). Never `rm` something `offload` could move, and never a second archive path.
- **Each kind of data has one owner** (transcripts: offload; install backups: install's retention; logs: journald's
  cap; an outline's change log: compaction). Fix the owner; don't sweep around it.
- **Dry run first** for anything that removes, and show its list before the real run.
