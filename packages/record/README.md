# record

Record the primary Mac display, system audio, microphone, and mouse cursor from
a single npm command. The package bundles a headless native `Record.app`, so
runtime dependencies are only macOS 15+, Node.js, and npm.

## Install and run

Run without installing:

```bash
npx @nocdn/record
```

## Usage

```bash
npx @nocdn/record [options]
npx @nocdn/record --only-mic
npx @nocdn/record --internal
npx @nocdn/record --only-audio
npx @nocdn/record --only-audio --separate-audio-tracks
npx @nocdn/record --window Safari
npx @nocdn/record --region
npx @nocdn/record --for 30s --in 3
npx @nocdn/record --here
npx @nocdn/record mics
npx @nocdn/record windows
npx @nocdn/record cameras
npx @nocdn/record permissions
```

| flag                                                                          | description                                                                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `-h`, `--help`                                                                | show help                                                                                                        |
| `-v`, `--version`                                                             | show version                                                                                                     |
| `-o`, `--output <path>`                                                       | save to an exact path instead of the default location                                                            |
| `--location <dir>`                                                            | save into this directory with a timestamped name (`--location .`, `--location ~/Pictures`)                       |
| `--here`                                                                      | save into the current directory (same as `--location .`)                                                         |
| `--only-mic`, `--mic-only`, `--microphone`                                    | record only the microphone as MP3                                                                                |
| `--only-system-audio`, `--system-audio-only`, `--internal`, `--internal-only` | record only system/application audio as MP3 (add `--mic <name>` to also include the mic, same as `--only-audio`) |
| `--only-audio`, `--audio-only`                                                | record system/application audio and the microphone as MP3, without video                                         |
| `--separate-audio-tracks`                                                     | store system audio and microphone as separate editable tracks instead of mixing them                             |
| `--only-camera`, `--camera-only`                                              | record only the camera                                                                                           |
| `--no-mic`                                                                    | disable microphone capture                                                                                       |
| `--mic <name>`                                                                | select a microphone by name; default is the built-in Mac microphone, not the current system input                |
| `--list-mics`                                                                 | list microphones that `--mic` can select                                                                         |
| `--no-system-audio`                                                           | disable system/application audio                                                                                 |
| `--window`, `--app <name>`                                                    | capture a window by app or title instead of the whole display                                                    |
| `--region [x,y,w,h]`                                                          | capture a rectangle; omit the value to click-drag one                                                            |
| `--camera [name]`                                                             | overlay a face cam in the recording                                                                              |
| `--camera-size <0-1>`                                                         | face-cam width as a fraction of the video                                                                        |
| `--camera-position <pos>`                                                     | `bottom-right`, `bottom-left`, `top-right`, or `top-left`                                                        |
| `--for`, `--duration <duration>`                                              | stop and save after this long (`30`, `30s`, `1m30s`)                                                             |
| `--in`, `--delay <duration>`                                                  | wait this long before recording starts                                                                           |
| `--hevc`                                                                      | encode video with HEVC instead of H.264                                                                          |
| `--codec <h264\|hevc>`                                                        | video codec                                                                                                      |
| `--quality <low\|high>`                                                       | simple quality preset; the fine flags override it                                                                |
| `--scale <n>`                                                                 | scale video (`0.5` or `50`)                                                                                      |
| `--video-bitrate <rate>`                                                      | video bitrate (`8m`, `8000k`)                                                                                    |
| `--audio-bitrate <rate>`                                                      | audio bitrate (`192k`)                                                                                           |
| `--display <number>`                                                          | select a display, starting at `1`                                                                                |
| `--fps <number>`                                                              | set the frame rate, from greater than `0` through `120`                                                          |
| `--format <mp4\|mov>`                                                         | choose the output container                                                                                      |
| `--no-cursor`                                                                 | hide the mouse cursor                                                                                            |

With no flags, the command records the primary display at native resolution,
system audio, and the built-in Mac microphone (not whichever input macOS
currently has set as default), with a visible cursor, at 60 fps, H.264/AAC,
MP4, and a timestamped file in `~/Downloads`. `--no-mic` and `--no-system-audio`
turn those audio sources off.

Everything saves to `~/Downloads` by default, audio and video alike.
`--location <dir>` picks another directory (keeping the timestamped name),
`--here` saves into the current working directory, and `-o <path>` picks an
exact file path. Choose only one of them.

`--only-mic` skips the screen and system audio and writes a timestamped `.mp3`
file. `--only-system-audio` (also `--internal` or `--internal-only`) does the
same for internal audio. `--internal --mic <name>` (for example
`--internal --mic "MacBook"`) records internal audio plus that microphone,
same as `--only-audio --mic <name>`. `--only-audio` combines internal audio and the
microphone in one MP3 without video. `--only-camera` writes a camera-only movie.

`--separate-audio-tracks` keeps internal audio and microphone audio on two
independently editable tracks in the same file. With a screen recording, the
output remains MP4 or MOV. With `--only-audio`, the default output is an
audio-only MOV because MP3 cannot contain multiple tracks. An exact output path
may instead use `.mov`, `.mp4`, or `.m4a` for audio-only multi-track recording.
For example:

```bash
npx @nocdn/record --separate-audio-tracks
npx @nocdn/record --only-audio --separate-audio-tracks
npx @nocdn/record --only-audio --separate-audio-tracks --mic "AirPods"
```

`--window Safari` captures that app's window. `--region` with no value lets you
click-drag a rectangle; `--region 120,80,1280,720` uses display points from the
top-left of the selected display.

`--for 30s` stops and saves automatically. `--in 3` counts down before capture
starts. `--camera` puts a face cam in the corner. `--hevc` and `--quality high`
are the simple video knobs; `--codec`, `--scale`, `--video-bitrate`, and
`--audio-bitrate` override them.

Combine `--only-mic` or `--only-audio` with `--mic <name>` to pick a microphone,
or `-o` to choose a path. Names can be a full device name or a unique substring,
for example `--mic "AirPods"`.

List the devices `--mic` can use:

```bash
npx @nocdn/record mics
```

Stop with `Enter` or `Ctrl+C` to finalize and save. `Ctrl+D` or `Esc` discards
the recording and deletes the output file. A second `Ctrl+C` is an emergency
force quit and may leave an unusable file.

During recording, the terminal keeps one live duration line above the controls
hint. Each active audio source also gets a responsive ASCII peak meter, labeled
`System` or `Mic`. A microphone-only or system-only recording shows one meter,
recordings with both sources show two, and recordings without audio show none.
Meters use `░`, `▒`, `▓`, and `█` density steps for finer changes between each
character position.
The recording header lists the active sources, for example
`Recording [microphone, screen]`.

While recording, a square menu-bar stop control appears using the native
`stop.circle.fill` symbol. Click it to stop and save.

## Permissions

The first run may ask for Screen Recording and Microphone access. If Screen
Recording access is granted while a recording is being prepared, the command
may need to be run again so macOS restarts the native recorder with the new
permission.

Check the current state without starting a recording:

```bash
npx @nocdn/record permissions
```

Permissions are assigned to the bundled `Record.app`, which is deliberately a
background-only app with no window, Dock icon, or menu-bar item.

## Develop

```bash
# from the repository root
npm install
npm run build --workspace packages/record
npm test --workspace packages/record
npm start --workspace packages/record -- --help
```

The CLI entry point lives in [`bin/cli.js`](./bin/cli.js), and the native source
lives in [`native/record-native.swift`](./native/record-native.swift). `npm run
build` compiles arm64 and x86_64 helpers, combines them into a universal binary,
creates `vendor/Record.app`, and applies an ad-hoc signature by default. Set
`RECORD_SIGNING_IDENTITY` to a Developer ID Application identity for a signed
distribution build; non-ad-hoc builds use the Hardened Runtime and a secure
timestamp. After a Developer ID build, `npm run notarize` submits the app to
Apple and staples the ticket.

The package is intentionally built with plain ESM JavaScript and native Apple
frameworks; it has no npm runtime dependencies and does not require FFmpeg,
Homebrew, Xcode, or a virtual audio driver on the recording machine.
Audio-only MP3 encoding uses the Shine encoder (LGPL-2.0) in
`native/third_party/shine`.

## Publishing

[`record.yml`](../../.github/workflows/record.yml) builds the Swift helper on a
GitHub-hosted `macos-26` runner. On `main`, when `package.json` has a version
that is not already on npm, it signs `Record.app` with Developer ID, notarizes
it, staples the ticket, and a separate job publishes it with
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (no npm token;
the Apple secrets never share a job with the npm credentials). Pull requests
only compile and test; they do not notarize or publish.

Signing and notarization are what stop Gatekeeper from showing “Apple could
not verify” / “malware” when someone runs the helper from npm. They do **not**
skip macOS Screen Recording or Microphone prompts. Those are separate Privacy
& Security permissions and still appear on first use.

To enable a release once:

1. Push the repository to GitHub.
2. Add a `repository.url` field to `package.json` that exactly matches the
   GitHub repository URL.
3. On npmjs.com, configure the package as a GitHub Actions trusted publisher:
   use this repository owner/name, workflow filename `publish.yml`, and allow
   `npm publish`.

On npmjs.com, `@nocdn/record` trusts the `nocdn/packages` repository with
workflow filename `record.yml`. Releases need these repository secrets
(Settings → Secrets and variables → Actions):

| secret                            | value                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| `APPLE_DEVELOPER_ID_P12`          | base64 of the exported Developer ID Application `.p12`          |
| `APPLE_DEVELOPER_ID_P12_PASSWORD` | password for that `.p12`                                        |
| `APPLE_API_KEY`                   | contents of the App Store Connect API `.p8` key                 |
| `APPLE_API_KEY_ID`                | the key id, for example `AB12CD34EF`                            |
| `APPLE_API_ISSUER`                | the issuer UUID from App Store Connect (required for team keys) |

Instead of the API key trio you can set `APPLE_ID` and
`APPLE_APP_SPECIFIC_PASSWORD`. The workflow already uses team id
`7CAU3XFRLQ` and identity `Developer ID Application: Bartosz Bak (7CAU3XFRLQ)`.

Export the certificate from Keychain Access → My Certificates →
**Developer ID Application: Bartosz Bak**. Include the private key, set a
password, then:

```bash
base64 -i developer-id.p12 | pbcopy
```

Create an App Store Connect API key at
[Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
with at least the Developer role. The `.p8` file can be downloaded only
once.

To release, bump the version in `package.json` and push to `main`.

`npm publish` would normally run `prepack`, which rebuilds the helper and drops
the stapled ticket, so the workflow publishes with `--ignore-scripts` and ships
the notarized `vendor/Record.app` from the macOS job as-is.
