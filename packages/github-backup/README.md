# @nocdn/github-backup

A CLI to backup a whole github personal profile.

It runs the proven `ghcr.io/josegonzalez/python-github-backup` Docker image,
saves the backup to a local directory, and creates a timestamped zip archive.
It can optionally upload the archive to a Backblaze B2 bucket.

## Requirements

- npm / npx
- Docker installed, running, and usable by the user running this command
- `zip` installed and usable by the user running this command
- A fine-grained GitHub personal access token with access to the data you want
  to back up

The command checks Docker and `zip` before starting the backup. If either tool
is missing or not accessible from the current user, it exits with setup guidance.

Create the token at
<https://github.com/settings/personal-access-tokens/new>. Choose access to the
repositories and account data you want backed up.
GitHub's token docs are here:
<https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token>.

## Run

Run without installing:

```bash
npx @nocdn/github-backup
```

The interactive flow asks for:

- backup directory, defaulting to `~/backups/github`
- GitHub username
- repositories to exclude, with `extensions` shown as an example
- GitHub token, only if one is not already saved

The token is stored at `~/.config/github-backup/token` with restricted file
permissions and reused on later runs.

## Usage

```bash
npx @nocdn/github-backup [options]
```

| flag | description |
| --- | --- |
| `-b`, `--backup-dir <path>` | backup directory, defaulting to `~/backups/github` |
| `-e`, `--exclude <repo...>` | repositories to exclude; can be repeated |
| `-h`, `--help` | show help |
| `-u`, `--user <username>` | GitHub username to back up |
| `-v`, `--version` | show version |
| `--upload [target]` | upload target; currently supports `b2`; prompts when omitted |
| `--bucket <name>` | Backblaze B2 bucket name; prompts with `--upload b2` when omitted |
| `--bucket-path <path>` | Backblaze B2 folder prefix, defaulting to `/github` |
| `--b2-credentials-file <path>` | Backblaze B2 credentials file, defaulting to `~/.config/github-backup/b2` |
| `--rm` | remove the local zip archive after a successful upload |

Examples:

```bash
npx @nocdn/github-backup
npx @nocdn/github-backup --user octocat --backup-dir ~/backups/github
npx @nocdn/github-backup --user octocat --exclude repo1 repo2
npx @nocdn/github-backup --user octocat --exclude repo1 --exclude repo2
npx @nocdn/github-backup --user octocat --upload b2 --bucket backups --bucket-path /github
npx @nocdn/github-backup --user octocat --upload b2 --bucket backups --rm
```

## Backblaze B2 uploads

Use `--upload b2` to upload the zip archive after it is created:

```bash
npx @nocdn/github-backup --user octocat --upload b2 --bucket backups --bucket-path /github
```

The bucket is required when using `--upload b2`. If `--bucket` is omitted in an
interactive terminal, the command prompts for it. The bucket must already exist.
The command checks the bucket before starting the Docker backup and exits early
if the bucket does not exist or the stored key cannot access it.

The `--bucket-path` flag controls the folder prefix in B2 and defaults to
`/github`. For example, `--bucket backups --bucket-path /github` uploads to:

```text
b2://backups/github/github-backup-DD-MM-YYYY-HH-MM.zip
```

B2 represents folders as file-name prefixes, so the command creates the bucket
path before the Docker backup by uploading a zero-byte `.keep` marker under that
prefix. This also verifies that the stored key can write to the target location
before the backup starts.

The first B2 upload prompts for a Backblaze B2 application key ID and
application key. They are stored as JSON at `~/.config/github-backup/b2` with
restricted file permissions and reused on later runs. You can choose a different
path with `--b2-credentials-file`.

The B2 key needs permission to list the target bucket and write files to it.

By default, the local zip remains after upload. Add `--rm` to remove the local
zip only after the B2 upload succeeds.

This first B2 implementation uses B2's single-file upload API. If the zip is
larger than 5 GiB, the command exits with a clear error instead of attempting
the upload.

## Output

Before each run, the backup directory contents are cleared. The command refuses
to use `/` or your home directory as the backup directory.

The backup archive is created in the current working directory:

```text
github-backup-DD-MM-YYYY-HH-MM.zip
```

If the current working directory is inside the backup directory, the archive is
saved to your home directory instead.

Release asset files are excluded by the Docker image configuration. Release
metadata is still included.

## Develop

```bash
npm install
npm start
```

The CLI entry point lives in [`bin/cli.js`](./bin/cli.js). The package is built
with plain Node.js, uses ESM, and does not require a transpilation step.

## Publishing

This project includes a GitHub Actions workflow at
[`.github/workflows/publish.yml`](./.github/workflows/publish.yml) that publishes
the package to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers)
on every push, as long as the version in `package.json` is not already on npm.

To enable it once:

1. Push the repository to GitHub.
2. On npmjs.com, configure the package as a trusted publisher pointing at the
   `publish.yml` workflow in this repository.
3. Bump the version in `package.json` and push - the workflow will publish.
