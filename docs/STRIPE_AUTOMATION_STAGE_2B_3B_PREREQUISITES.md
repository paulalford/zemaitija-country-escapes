# Stage 2B-3B prerequisite correction — source preparation only

Prepared 2026-11-02. Requires independent review before protected credential access
or infrastructure provisioning. This document does not authorize either action.
No migration, seed, application, worker, scheduler, Stripe operation or Milestone 18
work is included. The existing development environment remains protected.

## Network correction

`docker-compose.stripe-automation.yml` now explicitly attaches its sole service to
`stripe_automation_internal`, a bridge named `zemaitija-stripe-automation-internal`
with `internal: true`. There is no implicit default-network attachment. The project,
PostgreSQL 17.6 image, database, `127.0.0.1:55433:5432` mapping, separate named volume,
role initializer, credential comparisons, health check and restart policy remain.
The existing `docker-compose.yml` is not modified.

This specifies network isolation; it does not establish actual connectivity or
prove firewall behavior. Host-loopback access on the internal bridge, actual network
membership, effective egress restriction and storage identity must be verified after
separately authorized provisioning. If localhost access fails, stop; do not silently
remove `internal: true` or attach another network. Collision checks must include the
new explicit network name as well as the container, volume, project and host port.

## Fingerprint helper: review before execution

Source: `scripts/prepare-protected-db-fingerprints.ts`. Do not run it during this
preparation checkpoint. Importing its definitions does not read or write files.
The targeted tests invoke only pure synthetic derivation and mocked filesystem IO;
they do not launch its CLI or read the actual protected file.

The future explicit CLI requires `--approved-read-protected-credentials`. This is
an operator acknowledgement, not proof of approval: separate human authorization
must precede execution. There is no arbitrary input-file or repository option.

Safeguards:

- Fixed canonical repository `/home/paul/Portfolio/zemaitija-country-escapes`, current
  working directory and helper location; relocation requires a reviewed source change.
- Only `PATH`, `HOME`, `LANG` and `LC_ALL` may be present in the child environment.
  Inherited Node options, PG variables, database URLs, Compose switches and other
  environment entries cause rejection before filesystem access.
- Input is exactly that repository's `.env.local`, opened read-only with no symlink
  following. It must be a regular single-link file, owned by the current UID, with
  no group/other permissions, and no more than 64 KiB. Reads are bounded even if
  the file grows. No permissions or source content are changed. A failing permission
  check is a stop; the helper does not repair the protected file.
- The helper parses a strict single-line dotenv subset without sourcing, executing
  shell content, loading values into `process.env`, or following secret references.
  Comments, optional `export`, single/double quotes and CRLF are supported. Duplicate
  assignment names, multiline values and unsupported syntax are rejected. Password
  expansion/backtick notation, blank values, surrounding value whitespace and duplicate
  passwords are rejected rather than interpreted.
- It requires all three explicit password definitions: `POSTGRES_PASSWORD`,
  `APP_DB_PASSWORD`, `MIGRATION_DB_PASSWORD`. There are no Compose-default or URL
  fallbacks. It requires explicit `POSTGRES_DB=zemaitija_dev`,
  `POSTGRES_USER=zemaitija_bootstrap`, `APP_DB_USER=zemaitija_app`, and
  `MIGRATION_DB_USER=zemaitija_migrator`. Optional port/environment/automation settings
  must match the expected development environment. If application/migration URLs
  are present, their database, host, port, roles and decoded passwords must agree.
- A literal password not representable by this intentionally limited parser requires
  review, not a best-guess hash. An absent identity or credentials stored elsewhere
  also requires review; never retrieve an alternative source automatically.
- Output parent must already be an absolute canonical, current-user-owned mode-0700
  directory, outside this repository and outside any ancestor Git working tree.
  Symlinked paths and inaccessible Git-boundary checks fail closed.
- A new mode-0700 private child directory is created with `mkdtemp`. Its file is
  opened exclusively with no symlink following and mode 0600, verified before writing,
  then flushed and closed. Existing output is never overwritten. All validation of
  protected values completes before creating output.
- Only the three SHA-256 assignment lines are written. Neither passwords nor hashes
  are printed. CLI success and failure messages are fixed strings; raw parser/IO
  errors, paths, file contents and environment values are not logged.
- No subprocesses, network clients, database modules or provider modules are used.
  Passwords never appear in shell arguments. The input buffer is cleared, but JavaScript
  string copies cannot be guaranteed erased from memory. Run on a trusted local host;
  this does not defend against the same UID/root or concurrent hostile filesystem edits.
- Partial private output is retained after IO failure, with a nonzero exit and no
  success message. Do not consume it or retry automatically. Inspection and cleanup
  require a separate decision. Fingerprints remain sensitive metadata, especially for
  weak historical passwords; never publish or paste them into reports.

The helper proves local file consistency only. It neither connects to PostgreSQL nor
proves that file passwords match actual role passwords or every historical secret.

### Proposed future usage — NOT executed

After independent approval for the protected read and private output creation:

```bash
set +x
umask 077
cd /home/paul/Portfolio/zemaitija-country-escapes

# Choose an approved private location outside every Git working tree.
# If it already exists, inspect its ownership/permissions; do not change it blindly.
fingerprint_parent="$HOME/.local/state/zemaitija-stripe-automation-fingerprints"
mkdir -m 700 "$fingerprint_parent"

env -i PATH="$PATH" HOME="$HOME" \
  node --experimental-strip-types scripts/prepare-protected-db-fingerprints.ts \
  --approved-read-protected-credentials --output-parent "$fingerprint_parent"
```

The parent of `fingerprint_parent` must already exist; do not create/modify unrelated
directories implicitly. No password or hash is passed as an argument. The fixed success
message means a new `protected-fingerprints-*` child contains a completed
`protected-fingerprints.env`. Identify that path locally using directory names only;
do not `cat`, source, upload or display the file. A failure requires investigation,
not alteration of `.env.local` or weakening of the checks.

## Compose input separation and exact validation commands

The fingerprint file contains exactly these Compose interpolation variables:

```text
AUTOMATION_PROTECTED_BOOTSTRAP_PASSWORD_SHA256
AUTOMATION_PROTECTED_APP_PASSWORD_SHA256
AUTOMATION_PROTECTED_MIGRATION_PASSWORD_SHA256
```

A separate approved mode-0600 file must contain only newly generated independent
`AUTOMATION_BOOTSTRAP_PASSWORD`, `AUTOMATION_APP_PASSWORD` and
`AUTOMATION_MIGRATION_PASSWORD`. Preparing those credentials is a later authorized
step. Do not put the protected plaintext passwords into either file.

Explicit `--env-file` arguments replace implicit `.env` input; the clean child
environment removes shell overrides. Compose does not load `.env.local` here, and
no repository migration, seed, application environment loader or helper is invoked.
The absolute single `--file`, explicit project/directory and local Docker context
avoid default development configuration selection. Multiple env files are supported
by the locally inspected Compose v2.40.3; later files override duplicate keys, so
the separately reviewed files must have disjoint exact key sets.

**Static command allowed at this checkpoint** (does not resolve secret values):

```bash
env -i PATH="$PATH" HOME="$HOME" docker --context default compose \
  --project-directory /home/paul/Portfolio/zemaitija-country-escapes \
  --project-name zemaitija-stripe-automation \
  --env-file /dev/null \
  --file /home/paul/Portfolio/zemaitija-country-escapes/docker-compose.stripe-automation.yml \
  config --no-interpolate --format json
```

The static check actually used pipes that JSON into assertions and prints only a
fixed pass/fail summary. It verifies the sole service, image, target, internal bridge,
network attachment, loopback port, volume and read-only initialization mount. It does
not inspect Docker resources or contact a daemon, database or external service.

**Fully interpolated validation command — NOT executed; later approval required:**

```bash
# Set these to the approved private file paths; these variables contain paths only.
: "${fingerprint_file:?Approved fingerprint file path required}"
: "${isolated_credentials_file:?Approved independent credential file path required}"

env -i PATH="$PATH" HOME="$HOME" docker --context default compose \
  --project-directory /home/paul/Portfolio/zemaitija-country-escapes \
  --project-name zemaitija-stripe-automation \
  --env-file "$fingerprint_file" \
  --env-file "$isolated_credentials_file" \
  --file /home/paul/Portfolio/zemaitija-country-escapes/docker-compose.stripe-automation.yml \
  config --quiet
```

Never use `config --environment`, print a resolved config, enable shell tracing or
publish full container environment inspection. Quiet validation checks Compose syntax
and required interpolation, not the shell entrypoint's password comparisons. A future
local redacted comparison/configuration assertion remains necessary before resource
creation. The container entrypoint retains its independent comparisons. Docker's
configured environment still holds isolated credentials and protected fingerprints;
restrict Docker access and do not claim the file mechanism removes that exposure.

## Verification and remaining gate

Only targeted synthetic tests, TypeScript with incremental output disabled, targeted
lint, static non-interpolated Compose validation and whitespace checks are permitted
here. No production helper execution or actual credential read is authorized.

Actual provisioning still requires independent approval, approved fingerprint
generation, independent credential preparation, clean resolved validation, repeated
resource/port collision checks, local-engine identity, then isolated initialization
and read-only role/storage/network/host-connectivity verification. No migration,
seed or Stage 2B-3C work is authorized by this correction.

Checkpoint verification: 120 tests passed across
`tests/stripe-automation-prerequisites.test.ts` and
`tests/stripe-automation-foundation.test.ts`, with
`STRIPE_AUTOMATION_ENABLED=false`. TypeScript (`tsc --noEmit --incremental false`),
targeted ESLint on the helper/test, non-interpolated Compose assertions and whitespace
checks passed. No real helper execution, protected credential read, private output
creation or Docker resource operation was performed. Existing working-tree changes
were preserved; this correction changes only the isolated Compose file and adds this
document, the helper and its test file.
