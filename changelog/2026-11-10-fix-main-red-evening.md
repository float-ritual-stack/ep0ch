### Main is green again: the drawer's lift and restore tests follow today's changes (PIE-1730)

- **The restored-group test groups a real links tile:** `b` after a restart still brings back a group saved in a shut drawer. The test now groups a links tile with the reader. It used to group the desk's replies tile, which lists only children, and since #1426 (PIE-1712) `b` never aims that tile.
- **The ✦a lift tests wait for the whole press** (`drawer-tiles` and `hyper`, whose four reds the ticket hadn't listed): the lift and then the person's keys going into it (PIE-1359). They used to read the keys after the press's first step. Since #1427 (PIE-1727), each step of a preset runs one microtask later.
- **No door code changed.** The tidy instructions test was red after #1426 and #1428 (PIE-1728) fixed it. It is green on main.
- **Run:** nothing.
