# focus-lock

A distraction blocker for Windows. The full design is in the [plan doc](https://claude.ai/artifact/A7Nu8QYV8HbXPG5BAJFfwS).

## Desktop app (`app/`)

One window on your PC to manage the whole blocker: blocking days and hours, strict mode, the block lists, your own sites and keywords, and the 72 hour early unlock. Chrome and Brave both follow the app, so you only set things once.

![Overview](docs/app-overview.png)

### Install

1. Open the repository's **Actions** tab, pick the latest **test** run, and download **FocusLock-windows** under Artifacts.
2. Run `Focus Lock Setup <version>.exe`, or use `FocusLock-portable-<version>.exe` without installing.
3. In the app, open **Browsers** and follow the steps to load the extension in Chrome and Brave. The installer puts the extension folder next to the app, and **Open the extension folder** takes you there.

The installed app starts with Windows and sits in the tray. Closing the window keeps it running; the tray menu has **Quit**.

To run it from source instead: `cd app`, `npm install`, `npm start`.

### Rules

| Change | What happens |
| --- | --- |
| Stricter: add hours, turn a list on, add a site or keyword, turn the blocker on, start or extend strict mode | Right away |
| Looser: fewer hours, turn a list off, remove a site or keyword, turn the blocker off | Waits 24 hours. Shown under **Waiting changes**, where you can cancel it |
| Any looser change during strict mode | Refused |
| Early unlock (during strict mode) | Strict mode ends 72 hours later. Your settings stay, and **Re-arm** starts strict mode again for the same length |

There are no blocking hours by default. Strict mode needs hours set and the blocker on, lasts up to 365 days, and cancels any waiting looser changes when it starts. Adult sites, pirate sites and SafeSearch are always on and can't be turned off in the app.

### How the app talks to the extension

The app runs a small server on `http://127.0.0.1:47821/v1/state` that only answers reads from this PC. The extension asks it for the settings every minute and when its settings page opens. If the app isn't running, the extension keeps the last settings it got.

Once the extension has heard from the app, its own settings page becomes read-only. While strict mode is on, the extension also checks every update and ignores one that is less strict than what it has (for example, the blocker off, fewer hours, a list off, or an early unlock without the 72 hour wait), so a fake server or an edited settings file can't switch blocking off.

The app keeps its settings in `%APPDATA%\Focus Lock\state.json`.

## Browser extension (`extension/`)

A Manifest V3 extension for Chrome and Brave with four kinds of blocking:

| Type | What it matches | Example |
| --- | --- | --- |
| Website | A domain and all its subdomains | `netflix.com` also blocks `help.netflix.com` |
| URL | A path inside a site | `amazon.com/gp/video`, `youtube.com/shorts` |
| Keyword | Words in the address (including search queries), the page title, or page text | `fmovies`, `watch free` |
| Genre | A category of sites, and YouTube videos by their YouTube genre | `video-streaming`, YouTube `Gaming` |

Full page loads are blocked by `declarativeNetRequest` rules. The content script catches the rest: in-app navigation (YouTube is a single-page app), page titles and text, and YouTube video genres.

### Try it

1. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder.
3. Click the Focus Lock icon in the toolbar to open the settings page.

### Settings page

Click the toolbar icon (or **Details > Extension options**) to open it.

When the desktop app manages the extension, this page only shows the settings. Without the app, it works on its own:

- **Blocker on.** The main switch.
- **Blocking hours.** Add time windows with days and a start and end time. There are no hours by default, so YouTube, social media and streaming sites stay open until you add some. A window that ends before it starts runs past midnight. Set the same start and end to block the whole day.
- **Strict mode.** Pick an end date and time and press **Start strict mode**. Until then you can't change the hours or turn the blocker off. You can extend it, but not shorten it. You need hours set and the blocker on to start it.
- **Early unlock.** While strict mode is on you can request an early unlock. Strict mode ends 72 hours after the request unless you cancel it. Your hours and lists stay as they are, and **Re-arm strict mode** starts it again for the same length.

### What gets blocked

| List | When |
| --- | --- |
| YouTube (all of it), social media, Netflix, Crunchyroll and other streaming sites | During your blocking hours |
| Adult sites and keywords, pirate streaming keywords | All the time, while the blocker is on |
| Google SafeSearch (adds `safe=active` to every search) | All the time, while the blocker is on |

### Configuration

The lists are in `extension/default-config.json`:

- `websites`, `urls`: lists of domains and URL prefixes.
- `keywords.url`, `keywords.title`, `keywords.text`: phrases to match. Keep `text` phrases specific to avoid false positives.
- `genres.blocked` plus `genres.sites`: which genres are on, and the sites in each (`social-media`, `video-streaming`, `adult` and others).
- `alwaysOn.genres`, `alwaysOn.keywords`: lists that apply outside the blocking hours too.
- `youtube.mode`: `"full"` (block YouTube entirely), `"genres"` (block the listed `blockedGenres`), or `"off"`. `blockShorts` blocks `/shorts`.
- `forceSafeSearch`: turns on Google SafeSearch.

A browser policy can supply the whole config as a JSON string under the extension's managed `config` key, and that replaces the defaults. The schema is in `extension/managed-schema.json`. The hours and strict mode are set on the settings page, not in this file.

### Limits

Strict mode locks the settings inside the app and the extension. It does not stop someone from removing the extension in the browser, uninstalling the app, or changing the PC's clock (a standard Windows account can't change the clock).

## Tests

```
npm test
```

GitHub Actions runs the same tests on every push.
