Try the monk [page::sysop-demo]
These numbers are made up. Your real readings land on [[sysop]] after the first tick.

kiln: 1.0G free of 64.0G; tempo pid 4242, RSS 47.0G; docker restart kiln-tempo !!!

::graph-stat
---
title: Machines now
items:
  - value: kiln
    label: memory 1.0G / 64.0G free · load 1.2 · disk 74.5G free · failed none
  - value: notebook
    label: asleep since 2026-10-30T20:00:00Z
---
::

::graph-uptime
---
title: kiln · a glyph a day
days: [ok, ok, degraded, ok, ok]
---
::

- **Look:** the button on [[sysop]] runs `ext.sysop.look`.
- **Calm:** the trip note's button runs the restart it names, then records the reading after.
- **Change a threshold:** edit the properties on [[sysop]]; the next tick reads them.
