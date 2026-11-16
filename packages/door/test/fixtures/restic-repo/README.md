# An empty restic repository, cheap to open

What `test/backup-restic.test.ts` copies for each made-up machine's repository (its `config` and `keys/`; restic's
other folders are made empty beside them). Nothing is in it: no snapshot, no data. Its password is the tests'
(`fictional-test-password`), its key's user and host are made up (`gardener` on `potting-shed`).

Why a fixture: restic tunes a repository's key to the machine at `init`, so that opening it costs about 0.5 s of one
core, and every restic command opens it. This key's parameters are small (scrypt N 8192, r 8, p 2): 0.04 s. The
tests run about 130 restic commands; nothing they check depends on how strong the key is.

How it was made (restic 0.19.1), should it ever need making again:

```sh
export RESTIC_PASSWORD=fictional-test-password
printf %s "$RESTIC_PASSWORD" > pw
restic -r repo init
# A second key, made while restic has a twentieth of a core, so its tuning comes out small; then the first one goes.
systemd-run --user --scope -q -p CPUQuota=5% restic -r repo key add --user gardener --host potting-shed --new-password-file pw
restic -r repo key list          # the first key's id
restic -r repo key remove <the first key's id>
restic -r repo check
```

Copy `repo/config` and `repo/keys/` here.
