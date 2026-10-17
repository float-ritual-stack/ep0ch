# Changelog

## 3 (2026-10-16)

- Reads the runbook's values and each run's status and exit code from the call's records (`context.block`), not by scanning text. A property written twice or as a list is read as the values it holds.

## 2 (2026-10-10)

- Ships a demo runbook: three steps (a dry one, one that joins a made-up secrets group, one that fails), written under
  the extension's page in the Extensions hub when it's installed.

## 1 (2026-10-10)

- Runbooks: a step is a block with a `run::` line and a command fence; secrets join by with-secrets group name; every
  run is recorded under the step.
