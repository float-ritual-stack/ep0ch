# Artifact deploy

Saving a note that names an `ep0ch-artifacts` repo deploys it: to Vercel when it builds, to float-2's static store when it's plain files.

## What you do

- **Install:** ctrl+k, type `&artifact`, and pick **install Artifact deploy** (Enter or a double click).
  - An agent runs `ep0ch act extensions.install id=artifact-deploy`.
  - It goes in this outline's own folder: each outline turns it on or off by itself.
- **Name a repo:** write `[artifact::ep0ch-artifacts/moth-garden]` on a note's header or a line of its own, then save.
  - `github.com/ep0ch-artifacts/moth-garden` and the full `https://` URL read the same.
  - Each save after that checks again and redeploys a new commit.
- **See it:** the repo's card says deploying, live at its URL, or failed with the command that finishes it.
  - Each run is an `[type::artifact-run]` note under the Artifacts catalogue.
- **Remove:** the power bar's remove row, or `ep0ch act extensions.uninstall id=artifact-deploy demo=keep`.
  - Notes keep their `[artifact::]` lines; saving them deploys nothing until it's back.
  - `ep0ch artifact deploy <repo>` still deploys by hand.

## What it adds

- **A rule:** a note with `[artifact::]` on any line runs `deploy-artifact` when it starts naming a repo and on each save.
- **A script:** `deploy-artifact` calls `artifact_deploy({ note: this.id })`, the service's deploy, as the CLI does.

## Outlines from before the kit

Until PIE-1509 the host wrote a `deploy-artifact` rule note and script note into every outline. At its next start it
installs this kit in the outline's own folder and moves those two notes to Trash, so deploying carries on with nothing
to redo. Notes someone edited are left as they wrote them, as their own rule, and the kit isn't installed there.

## Make it yours

- **Edit the script:** an outline's own `[script::deploy-artifact]` note answers before the kit's file does, and the kit's rule runs it.
