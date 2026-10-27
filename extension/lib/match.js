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

  // schedule: null (always on) or a list of windows
  // { days: [0-6, Sunday = 0], start: "HH:MM", end: "HH:MM" }.
  // A window whose end is before its start runs past midnight.
  function isBlockingActive(schedule, date) {
    if (!schedule || schedule.length === 0) return true;
    const now = date || new Date();
    const day = now.getDay();
    const minute = now.getHours() * 60 + now.getMinutes();
    for (const window of schedule) {
      const days = window.days || [0, 1, 2, 3, 4, 5, 6];
      const start = minutesOf(window.start);
      const end = minutesOf(window.end);
      if (start <= end) {
        if (days.includes(day) && minute >= start && minute < end) return true;
      } else {
        const yesterday = (day + 6) % 7;
        if (days.includes(day) && minute >= start) return true;
        if (days.includes(yesterday) && minute < end) return true;
      }
    }
    return false;
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
    return rules;
  }

  const api = {
    normalizeText,
    findKeyword,
    domainMatches,
    isBlockingActive,
    siteBlockReason,
    youtubeGenreBlocked,
    extractYoutubeGenre,
    buildDnrRules
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FocusMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
