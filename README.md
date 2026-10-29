# PassWordCreaterManager

Derives site passwords from two things you can remember, entirely offline, on Windows and Android.

## Status

Usable as a local tool. No telemetry, no analytics, no remote logging, no sync, no server, and no network calls at runtime.

The derivation parameters are frozen at version 2. Changing any of them changes every password the app has ever produced, so they are not tunables.

## How it works

Two layers feed a key derivation function, and the result is recomputed on demand rather than stored.

Layer 1 is the app account: a name and a master password. It never leaves the device.

Layer 2 is per entry: the site account name and a simple password you would have used anyway, for example `github-2019`.

Both layers are folded into a salt, stretched with PBKDF2, then expanded into a byte stream that selects characters.

### Derivation pipeline

Inputs: `appName`, `appPassword`, `site`, `simple`, `length`, `counter`, `symbols`.

1. Normalize: `norm(x) = trim(x).toLowerCase()`.
2. Salt: `"pwvault:v2" + "|" + norm(appName) + "|" + norm(site) + "|" + simple`.
3. Key: `PBKDF2-HMAC-SHA256(appPassword, salt, 100000 iterations, 32 bytes)`.
4. Stream: `HMAC-SHA256(key, norm(site) + ":" + counter + ":" + block)` for `block = 0, 1, 2, ...`, concatenated until enough bytes exist. This stream is the only source of randomness.
5. Selection: bytes are mapped onto `lower + upper + digits + symbols` by rejection sampling, skipping any byte `>= 256 - (256 % pool.length)`. Symbols are `!@#$%^&*()-_=+[]{}:,.<>?/`.
6. Class guarantee: at least one character from each enabled class appears in the result.
7. Order: Fisher-Yates over the same stream.
8. Length: clamped to `8..64`. The counter is a per-entry integer; incrementing it yields an unrelated password for the same site.

The output is the password you register on that site.

### Test vectors

Inputs, shared by all rows: app account `allpay`, app password `123456`, site account `ABC`, simple password `github-abc`.

| length | counter | symbols | expected output |
| --- | --- | --- | --- |
| 16 | 1 | yes | `?XtHrM3>1As%iPT*` |
| 24 | 1 | no | `TGstXqMWTIxAPH8TQiZwHTes` |
| 20 | 2 | yes | `>%}3/:>.&U>vO#}/K^{h` |

Normalization means `ALLPAY` and ` allpay ` derive the same passwords as `allpay`. Any build that disagrees with this table is broken.

## Threat model and limitations

The design protects against password reuse: a password leaked by one site says nothing about your other sites, and nothing about either layer.

It does not protect against the following.

- A compromised device. Code running in the app's context can read the master password as it is typed and read derived passwords as they are produced.
- A keylogger, software or hardware.
- A forgotten master password. There is no reset, no recovery code, and no vendor-side escrow. Lose layer 1 and every derived password is gone.
- A malicious build. The offline claim rests on this source and the binary you compiled from it. A substituted WebView2 DLL or a repackaged APK can do anything.
- A trivial simple password. Layer 2 is deliberately low entropy; the KDF raises the cost of guessing but does not turn `1234` into a strong secret.
- Physical access to an unlocked session.

Only the inputs are stored. A leaked app database exposes layer 1 and every simple password, which is equivalent to a leaked password manager vault.

## Build

Requirements: Node.js 20 or newer for the web assets, .NET Framework 4.8 with `csc.exe` (included in Windows) for the desktop host, JDK 17 and the Android SDK for the Android shell.

### Web

```bash
npm ci
npm run build        # emits dist/
```

Both native shells embed the contents of `dist/`.

### Desktop

```powershell
.\desktop\build.ps1
```

The script packs `dist/` into an embedded resource, compiles `desktop/src/Launcher.cs` into `PassWordCreaterManager.exe`, and copies the WebView2 assemblies next to it. It looks for the Microsoft.Web.WebView2 package under `%USERPROFILE%\.nuget\packages`; pass `-WebView2Dir <path to lib\net462>` when it lives elsewhere.

The output directory needs `PassWordCreaterManager.exe`, `Microsoft.Web.WebView2.Core.dll`, `Microsoft.Web.WebView2.WinForms.dll`, and `WebView2Loader.dll`. The exe will not start without them, and the machine needs the WebView2 runtime, which ships with Windows 11 and current Windows 10.

### Android

```bash
cd android
gradlew assembleRelease        # ANDROID_HOME and JAVA_HOME must be set
```

The APK lands in `android/app/build/outputs/apk/release/`. The checked-in `app/debug.keystore` is a throwaway key so the release build runs out of the box; it is not suitable for distribution and carries no security value.

## Architecture

Web UI: TypeScript, Vite, Material Web components (`@material/web`), Material 3 Expressive styling, light/dark/system themes, five accent seeds, IndexedDB for storage. Derivation runs in the page through WebCrypto; nothing is computed natively.

Desktop: a .NET Framework 4.8 WinForms window hosting WebView2. The page is served from an embedded zip through a virtual host mapped to `https://app.local`. The origin is fixed on purpose: IndexedDB is scoped per origin, so a stable origin keeps the local database alive across restarts and updates. Backups are written through the host bridge to the user's Downloads folder.

Android: a minimal `WebView` shell built with AGP 8.13 (`compileSdk 36`, `minSdk 24`). Assets are served by `WebViewAssetLoader` at `https://appassets.androidplatform.net`, and a JavaScript bridge named `pvb` writes backups into the public Downloads collection.

## Usage

First run: create an app account (name plus master password, at least eight characters). The lock screen lists accounts as chips and asks for the matching master password. "Remember" stores the choice and reopens the vault directly next time; "Lock" returns to the lock screen.

Adding an entry: press the button at the bottom right, fill in a note, the site or service, an optional URL, and the simple password. The derived password appears immediately, masked. The eye button reveals it, the copy button always works, and the slider changes length while the switch drops or keeps symbols. The counter field produces a different password for the same site, which is how you rotate one.

Finding an entry: the search box filters by note, site, account, or URL. `Ctrl+K` focuses it, `Ctrl+N` creates an entry.

Backups: the menu exports a JSON file, imports a file, or imports pasted JSON. Import merges by account name and drops duplicate entries. Treat the export as a credential.

Wipe: the menu clears the IndexedDB database and reloads into first-run state.

## Repository layout

```
PassWordCreaterManager/
  index.html          entry point for the Vite build
  src/                TypeScript sources: main.ts, db.ts, derive.ts, theme.ts, styles.css
  brand/              icon source (SVG), rasterized PNG, generated ICO
  desktop/            .NET Framework WinForms host and build.ps1
  android/            Gradle project, WebView shell
  docs/screenshots/   screenshots used in this file
  dist/               build output, not tracked
```

## Screenshots

| Lock screen | Entry | Dark theme |
| --- | --- | --- |
| ![lock](docs/screenshots/lock.png) | ![entry](docs/screenshots/entry.png) | ![dark](docs/screenshots/dark.png) |

## Backup file format

UTF-8 JSON, two-space indented. `accounts` carries layer 1, `entries` carries layer 2. Derived passwords are absent by design: they are recomputed from the stored inputs.

```json
{
  "format": "password-creater-manager-backup",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "accounts": [
    {
      "name": "allpay",
      "password": "master password, in clear",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "entries": [
    {
      "accountName": "allpay",
      "note": "GitHub",
      "site": "github.com",
      "url": "https://github.com",
      "password": "layer-2 simple password, in clear",
      "length": 20,
      "counter": 1,
      "symbols": true
    }
  ]
}
```

`format` is checked on import. Files exported by the earlier PwVault build (`"format": "pwvault-backup"`) are still accepted.

## Data locations

- Web preview: IndexedDB database `PassWordCreaterManager` in the browser profile.
- Desktop: `webview2data/` next to the exe, origin `https://app.local`.
- Android: WebView storage for `https://appassets.androidplatform.net`.

## Compatibility

Frozen: the salt prefix `pwvault:v2`, PBKDF2-HMAC-SHA256 at 100000 iterations with a 32-byte output, the HMAC-SHA256 stream construction, the charset and its order, rejection sampling, the one-character-per-class rule, Fisher-Yates over the same stream, and the `8..64` clamp. The salt prefix keeps its original spelling so passwords derived by earlier builds stay valid; it is an input string, not the product name.

Windows and Android share one implementation and must stay byte-identical. The test vectors above are the check.

## License

MIT. See [LICENSE](LICENSE).

## AI disclosure

This project was generated by an AI coding agent (DeepSeek-based) from a specification written by the publisher, then reviewed, built, and tested by hand. The derivation algorithm, the web UI, the desktop host, and the Android shell were all produced this way. The vectors above were recomputed from an independent implementation and cross-checked against the shipped binary and the browser build. Read the source before trusting it with real credentials: `src/derive.ts` is short enough to audit end to end.
