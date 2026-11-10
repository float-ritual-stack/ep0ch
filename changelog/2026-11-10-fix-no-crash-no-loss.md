### The door never crashes on an empty stage or drops an edit in a gather (PIE-1726)

- **`e` in the drawer's reader with the stage empty arms the edit, no crash:** the armed edit's hint goes to the desk that holds its reader (the drawer's, a group's), and an empty screen paints no mode, so `ActionRefused: this screen is empty` never escapes a paint again.
- **Gathering a rebuilt reader keeps its open edit:** a reader closed once and brought back (`ask2` in the place `ask` fills) goes into the group as itself, editing, every typed word there, and `^W B` brings it back still editing. The group finds each gathered tile by its name: the stage's place (`slot`) no longer travels into the group, where the group looked the tile up by that place, missed it, and made a fresh reader of the note.
- **Run:** nothing; the door picks it up at its next start.
