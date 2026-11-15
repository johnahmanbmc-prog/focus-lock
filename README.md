# focus-lock

A distraction blocker for Windows. The full design is in the [plan doc](https://claude.ai/artifact/A7Nu8QYV8HbXPG5BAJFfwS).

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

Strict mode locks the settings inside the extension. It does not stop someone from removing the extension in the browser.

## Tests

```
npm test
```

GitHub Actions runs the same tests on every push.
