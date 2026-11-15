// Pure matching logic shared by the background worker, the content script
// and the Node tests. Loaded as a classic script (no modules) so it works in
// all three places.
(function (root) {
  'use strict';

  function normalizeText(value) {
    let text = String(value || '');
    try {
      text = decodeURIComponent(text.replace(/\+/g, ' '));
    } catch (e) {
      text = text.replace(/\+/g, ' ');
    }
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function findKeyword(text, keywords) {
    const haystack = normalizeText(text);
    for (const keyword of keywords || []) {
      const needle = normalizeText(keyword);
      if (needle && haystack.includes(needle)) return keyword;
    }
    return null;
  }

  function domainMatches(host, domains) {
    const h = String(host || '').toLowerCase().replace(/\.$/, '');
    for (const domain of domains || []) {
      const d = String(domain).toLowerCase().replace(/^\*?\./, '');
      if (d && (h === d || h.endsWith('.' + d))) return domain;
    }
    return null;
  }

  function minutesOf(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
  }

  // schedule: null (always on), [] (no hours set, so nothing is blocked) or a
  // list of windows { days: [0-6, Sunday = 0], start: "HH:MM", end: "HH:MM" }.
  // A window whose end is before its start runs past midnight, and a window
  // whose start equals its end covers the whole day.
  function isBlockingActive(schedule, date) {
    if (schedule === null || schedule === undefined) return true;
    if (schedule.length === 0) return false;
    const now = date || new Date();
    const day = now.getDay();
    const minute = now.getHours() * 60 + now.getMinutes();
    for (const window of schedule) {
      const days = window.days || [0, 1, 2, 3, 4, 5, 6];
      const start = minutesOf(window.start);
      const end = minutesOf(window.end);
      if (start === end) {
        if (days.includes(day)) return true;
      } else if (start < end) {
        if (days.includes(day) && minute >= start && minute < end) return true;
      } else {
        const yesterday = (day + 6) % 7;
        if (days.includes(day) && minute >= start) return true;
        if (days.includes(yesterday) && minute < end) return true;
      }
    }
    return false;
  }

  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

  const UNLOCK_DELAY = 72 * 3600 * 1000;

  function defaultSettings() {
    return { enabled: true, schedule: [], strictUntil: null, unlockAt: null, lastStrictLength: null };
  }

  // Strict mode runs until its end time, or until a requested early unlock
  // comes due, whichever is first.
  function isStrict(settings, now) {
    const s = settings || {};
    if (typeof s.strictUntil !== 'number' || s.strictUntil <= now) return false;
    return !(typeof s.unlockAt === 'number' && s.unlockAt <= now);
  }

  function cleanSchedule(schedule) {
    if (!Array.isArray(schedule)) throw new Error('Schedule must be a list.');
    return schedule.map(window => {
      const days = [...new Set((window.days || []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
      if (!days.length) throw new Error('Pick at least one day for each time window.');
      if (!TIME.test(window.start) || !TIME.test(window.end)) throw new Error('Times must look like 09:00.');
      return { days, start: window.start, end: window.end };
    });
  }

  function sameSchedule(a, b) {
    const key = list => JSON.stringify(list.map(w => [w.days, w.start, w.end]));
    return key(a) === key(b);
  }

  // The user's own settings: whether blocking is on, the blocking hours, and
  // strict mode. While strict mode runs, the hours and the on/off switch are
  // locked and strict mode can only be extended. Returns the settings to
  // save, or throws an Error whose message is shown to the user.
  function applySettingsChange(current, change, now) {
    const cur = { ...defaultSettings(), ...(current || {}) };
    const next = { ...cur };
    const strict = isStrict(cur, now);

    if ('schedule' in change) {
      const schedule = cleanSchedule(change.schedule);
      if (strict && sameSchedule(schedule, cleanSchedule(cur.schedule)) === false) {
        throw new Error('Strict mode is on, so the blocking hours are locked.');
      }
      next.schedule = schedule;
    }
    if ('enabled' in change) {
      const enabled = Boolean(change.enabled);
      if (strict && enabled !== cur.enabled) {
        throw new Error('Strict mode is on, so the blocker cannot be turned off.');
      }
      next.enabled = enabled;
    }
    if (change.rearm) {
      if (strict) throw new Error('Strict mode is already on.');
      if (!cur.lastStrictLength) throw new Error('There is no earlier strict mode to re-arm.');
      change = { ...change, strictUntil: now + cur.lastStrictLength };
    }
    if ('strictUntil' in change) {
      const until = Number(change.strictUntil);
      if (!Number.isFinite(until) || until <= now) throw new Error('Strict mode needs an end time in the future.');
      if (strict && until < cur.strictUntil) throw new Error('Strict mode can be extended but not shortened.');
      if (!next.enabled) throw new Error('Turn the blocker on before starting strict mode.');
      if (!next.schedule.length) throw new Error('Set your blocking hours before starting strict mode.');
      next.strictUntil = until;
      if (!strict) {
        next.lastStrictLength = until - now;
        next.unlockAt = null;
      }
    }
    if (change.requestUnlock) {
      if (!strict) throw new Error('Strict mode is not on.');
      if (!next.unlockAt) next.unlockAt = now + UNLOCK_DELAY;
    }
    if (change.cancelUnlock) next.unlockAt = null;
    if (!isStrict(next, now)) {
      next.strictUntil = null;
      next.unlockAt = null;
    }
    return next;
  }

  function union(a, b) {
    return [...new Set([...(a || []), ...(b || [])])];
  }

  // What to block right now. Outside the blocking hours only the always-on
  // lists (adult content and pirate keywords) apply. Returns null when
  // nothing should be blocked.
  function effectiveConfig(config, enabled, inHours) {
    const cfg = config || {};
    if (!enabled) return null;
    const always = cfg.alwaysOn || {};
    const genres = cfg.genres || {};
    if (inHours) {
      const keywords = cfg.keywords || {};
      return {
        ...cfg,
        keywords: { ...keywords, url: union(keywords.url, always.keywords), title: union(keywords.title, always.keywords) },
        genres: { ...genres, blocked: union(genres.blocked, always.genres) }
      };
    }
    return {
      websites: [],
      urls: [],
      keywords: { url: always.keywords || [], title: always.keywords || [], text: [] },
      genres: { blocked: always.genres || [], sites: genres.sites || {} },
      youtube: { mode: 'off' },
      forceSafeSearch: cfg.forceSafeSearch
    };
  }

  function blockedGenreSites(config) {
    const genres = (config && config.genres) || {};
    const sites = [];
    for (const genre of genres.blocked || []) {
      for (const site of (genres.sites || {})[genre] || []) {
        sites.push({ site, genre });
      }
    }
    return sites;
  }

  function stripUrl(url) {
    return (url.hostname.replace(/^www\./, '') + url.pathname).toLowerCase();
  }

  // Returns a short reason string when the URL should be blocked, else null.
  function siteBlockReason(urlString, config) {
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      return null;
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    const cfg = config || {};

    const site = domainMatches(url.hostname, cfg.websites);
    if (site) return 'website: ' + site;

    for (const entry of blockedGenreSites(cfg)) {
      if (domainMatches(url.hostname, [entry.site])) return 'genre: ' + entry.genre;
    }

    const bare = stripUrl(url);
    for (const pattern of cfg.urls || []) {
      const p = String(pattern).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
      if (p && bare.startsWith(p)) return 'url: ' + pattern;
    }

    const keyword = findKeyword(url.href, (cfg.keywords || {}).url);
    if (keyword) return 'keyword: ' + keyword;

    const yt = cfg.youtube || {};
    if (domainMatches(url.hostname, ['youtube.com', 'youtu.be'])) {
      if (yt.mode === 'full') return 'website: youtube.com';
      if (yt.blockShorts && url.pathname.startsWith('/shorts')) return 'url: youtube.com/shorts';
    }
    return null;
  }

  function youtubeGenreBlocked(genre, config) {
    const yt = (config && config.youtube) || {};
    if (yt.mode !== 'genres' || !genre) return null;
    const g = normalizeText(genre);
    for (const blocked of yt.blockedGenres || []) {
      if (normalizeText(blocked) === g) return 'genre: YouTube ' + blocked;
    }
    return null;
  }

  function extractYoutubeGenre(html) {
    const text = String(html || '');
    const meta = text.match(/<meta\s+itemprop="genre"\s+content="([^"]*)"/i);
    if (meta) return meta[1].replace(/&amp;/g, '&');
    const json = text.match(/"category"\s*:\s*"([^"]+)"/);
    return json ? json[1].replace(/\\u0026/g, '&') : null;
  }

  // declarativeNetRequest rules for full page loads. SPA navigation and
  // keyword/genre checks are handled by the content script.
  function buildDnrRules(config, blockedPage) {
    const cfg = config || {};
    const page = blockedPage || '/blocked.html';
    const frames = ['main_frame', 'sub_frame'];
    const rules = [];
    let id = 1;
    const redirect = reason => ({
      type: 'redirect',
      redirect: { extensionPath: page + '?reason=' + encodeURIComponent(reason) }
    });

    const domains = [...(cfg.websites || [])];
    if ((cfg.youtube || {}).mode === 'full') domains.push('youtube.com', 'youtu.be');
    if (domains.length) {
      rules.push({
        id: id++,
        priority: 1,
        action: redirect('website'),
        condition: { requestDomains: domains.map(d => d.toLowerCase()), resourceTypes: frames }
      });
    }

    const genreSites = blockedGenreSites(cfg);
    if (genreSites.length) {
      rules.push({
        id: id++,
        priority: 1,
        action: redirect('genre'),
        condition: { requestDomains: genreSites.map(e => e.site.toLowerCase()), resourceTypes: frames }
      });
    }

    const urls = [...(cfg.urls || [])];
    if ((cfg.youtube || {}).blockShorts) urls.push('youtube.com/shorts');
    for (const pattern of urls) {
      const p = String(pattern).replace(/^https?:\/\//, '').replace(/^www\./, '');
      rules.push({
        id: id++,
        priority: 1,
        action: redirect('url: ' + pattern),
        condition: { urlFilter: '||' + p, resourceTypes: frames }
      });
    }
    // Turn on Google SafeSearch by adding safe=active to every search.
    if (cfg.forceSafeSearch) {
      rules.push({
        id: id++,
        priority: 2,
        action: { type: 'redirect', redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key: 'safe', value: 'active' }] } } } },
        condition: { regexFilter: '^https://(www\\.)?google\\.[a-z.]+/search\\?', resourceTypes: ['main_frame'] }
      });
    }
    return rules;
  }

  const api = {
    effectiveConfig,
    UNLOCK_DELAY,
    normalizeText,
    findKeyword,
    domainMatches,
    isBlockingActive,
    defaultSettings,
    isStrict,
    applySettingsChange,
    siteBlockReason,
    youtubeGenreBlocked,
    extractYoutubeGenre,
    buildDnrRules
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FocusMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
