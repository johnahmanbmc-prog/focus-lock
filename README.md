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
3. Visit `netflix.com`, `youtube.com/shorts/...`, or search for `watch free` and you'll see the blocked page.

### Configuration

The defaults are in `extension/default-config.json`:

- `schedule`: `null` means always on. Otherwise it's a list of windows like `{ "days": [1,2,3,4,5], "start": "09:00", "end": "23:00" }` (Sunday = 0). A window whose end is before its start runs past midnight.
- `websites`, `urls`: lists of domains and URL prefixes.
- `keywords.url`, `keywords.title`, `keywords.text`: phrases to match. Keep `text` phrases specific to avoid false positives.
- `genres.blocked` plus `genres.sites`: which genres are on, and the sites in each.
- `youtube.mode`: `"genres"` (block the listed `blockedGenres`), `"full"` (block YouTube entirely), or `"off"`. `blockShorts` blocks `/shorts`.

A browser policy can supply the whole config as a JSON string under the extension's managed `config` key, and that replaces the defaults. The schema is in `extension/managed-schema.json`.

### Open decisions

- Blocking hours (`schedule`) are still `null`, which means always on.
- YouTube is set to `genres` mode. Switch it to `full` for a complete block.

## Tests

```
npm test
```

GitHub Actions runs the same tests on every push.
