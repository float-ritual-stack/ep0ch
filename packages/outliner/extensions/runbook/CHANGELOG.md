# Changelog

## 6 (2026-10-19)

- Runnable fences run independently with document-order context, private prompts, login shells and separate run records (PIE-1098).
- Removes walks, modes, host execution, SSH flags, kept answers and the props form.


## 5 (2026-10-19)

- Steps default to the door's terminal tile, with run controls, masked argument forms, SSH execution and a sequential run-all walk (PIE-1061). Host mode keeps the noninteractive runner.
- Output is recorded through the extension after the terminal exits; supplied secrets use environment variables and the shared scrubber.
- The page's example uses a longer outer fence so its nested command fences render.

## 4 (2026-10-17)

- Step results now sit in output regions after the command, with attributed patches and draft conflict proposals. The running region is replaced when the command finishes; no result child is made. Whole-run summaries remain machinery notes (PIE-956).
- **Breaking.** A step's `{{name}}` is no longer the runbook note's property of that name. It is the outline's one
  `{{ }}` grammar, filled by the service (`site.answer` with `interpolate`), and the Site names where a value is from:
  `{{self.name}}` (the runbook note's own; trusted), `{{props.name}}` (what the run is given; checked for the shell),
  any other head (checked the same way). `ep0ch install --apply` rewrites an old step's `{{name}}` to `{{self.name}}`
  (the brace sweep, its `runbook-step` form).
- A step with a placeholder that has no value, or a value outside the runbook note that could build a command, does not
  run; the record says which and what to write.
- The extension reads no template syntax of its own: the placeholder scan, the value lookup and the substitution are the
  service's. A list value is all its values joined with `, `.
- Running the whole runbook asks, in the door, for the runbook note's `[form-field::name text]` chips (the run's props).

## 3 (2026-10-16)

- Reads the runbook's values and each run's status and exit code from the call's records (`context.block`), not by scanning text. A property written twice or as a list is read as the values it holds.

## 2 (2026-10-10)

- Ships a demo runbook: three steps (a dry one, one that joins a made-up secrets group, one that fails), written under
  the extension's page in the Extensions hub when it's installed.

## 1 (2026-10-10)

- Runbooks: a step is a block with a `run::` line and a command fence; secrets join by with-secrets group name; every
  run is recorded under the step.
