# focus-lock

A distraction blocker for Windows 11. The full design is in the [plan doc](https://claude.ai/artifact/A7Nu8QYV8HbXPG5BAJFfwS).

Focus Lock is a desktop app plus a Windows service. The service writes Chrome, Brave and Edge **browser policies**, so the browsers do the blocking themselves and no extension is needed. An App Control policy blocks other browsers.

![Overview](docs/app-overview.png)

## What it does

- **Blocking hours:** you set the days and times. There are no default hours. During those hours YouTube, social media, streaming (Netflix, Prime Video, Disney+, Twitch and others), anime and sports streaming, and your own sites are blocked. You can switch each list on or off.
- **Always on**, whenever the blocker is on: adult sites, known pirate streaming sites, and any of your sites marked "all the time".
- **Always on in every browser:** SafeSearch in Google and Bing, YouTube Restricted Mode, no incognito/InPrivate/guest windows, no secure DNS, and no Tor windows in Brave.
- **Strict mode:** locks the hours, the lists and the off switch until an end time. You can extend it but not shorten it.
- **Early unlock:** ends strict mode 72 hours after you ask, unless you cancel. Your settings stay as they are, and **Re-arm** starts strict mode again.
- **Other browsers** (Firefox, Opera, Opera GX, Vivaldi, Tor, DuckDuckGo, Waterfox, LibreWolf, Floorp, Yandex, Arc, Zen, Pale Moon, Mullvad) are blocked. Every other program runs as normal.

### Rules

| Change | What happens |
| --- | --- |
| Stricter: add hours, turn a list on, add a site, turn the blocker on, start or extend strict mode | Right away |
| Looser: fewer hours, turn a list off, remove a site, turn the blocker off | Waits 24 hours. Shown under **Waiting changes**, where you can cancel it |
| Any looser change during strict mode | Refused |

Strict mode needs hours set and the blocker on, and lasts up to 365 days. Starting it cancels any looser changes still waiting.

## Install

The person who holds the admin password does the setup, following **[docs/HELPER-SETUP.md](docs/HELPER-SETUP.md)**. In short:

1. Make an admin account for the helper, and make Yahya's account a standard user.
2. Download **FocusLock-windows** from the latest **test** run in the Actions tab, and run `FocusLock-Setup-<version>.exe`.
3. Run `admin/browser-block/Enable-BrowserBlock.ps1` in audit mode for a day, then run it again with `-Enforce`.

To run the app from source during development: `cd app`, `npm install`, `npm start`. Without the service, the app runs the engine itself, keeps the settings in its own folder, and doesn't change the browsers.

## How it fits together

| Part | Runs as | What it does |
| --- | --- | --- |
| Focus Lock service (`app/service.js`, run by WinSW) | SYSTEM | Owns the settings in `C:\ProgramData\FocusLock\state.json`. Applies the rules, writes the browser policies to `HKLM\SOFTWARE\Policies`, and serves the app on `127.0.0.1:47821` |
| Focus Lock app (`app/main.js`) | Yahya | The window and the tray icon. Reads the settings from the service and sends it changes |
| `app/core/blocklists.json` | | The sites in each list |
| `app/admin/install.ps1` | Administrator | Sets the folder permissions and installs the service |
| `app/admin/browser-block/` | Administrator | Blocks other browsers with App Control for Business |

Standard users can read `C:\ProgramData\FocusLock` and `HKLM\SOFTWARE\Policies`, but not change them. The service only accepts changes that the rules allow, so a direct request to it can't do more than the app window can. Web pages can't send it changes at all.

Every 20 seconds the service applies due changes, ends strict mode on time, and rewrites the browsers' `URLBlocklist` when the blocking hours start or end. It only rewrites the list when something has changed.

## Limits

- Browser policy blocks whole sites and paths, not keywords. A pirate site with a new name isn't blocked until it's added to `blocklists.json` or to your own sites. SafeSearch and YouTube Restricted Mode still filter searches and videos.
- Anyone with the admin password can undo everything. Other devices aren't covered.

## Tests

```
npm test
```

GitHub Actions runs the same tests on every push, and builds the Windows installer.
