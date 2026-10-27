// Content script: catches what network rules can't see, such as keywords in
// page titles and text, YouTube video genres, and single-page-app navigation.
(function () {
  'use strict';

  const { siteBlockReason, findKeyword, youtubeGenreBlocked, extractYoutubeGenre } = globalThis.FocusMatch;
  const TEXT_SCAN_LIMIT = 50000;

  let config = null;
  let blocked = false;
  let lastUrl = '';
  const genreCache = new Map();

  function block(reason) {
    if (blocked) return;
    blocked = true;
    chrome.runtime.sendMessage({ type: 'block', reason });
  }

  function checkUrl() {
    const reason = siteBlockReason(location.href, config);
    if (reason) block(reason);
  }

  function checkPage() {
    const keywords = config.keywords || {};
    const titleHit = findKeyword(document.title, keywords.title);
    if (titleHit) return block('keyword: ' + titleHit);
    if (document.body && (keywords.text || []).length) {
      const textHit = findKeyword(document.body.innerText.slice(0, TEXT_SCAN_LIMIT), keywords.text);
      if (textHit) return block('keyword: ' + textHit);
    }
  }

  // YouTube's page metadata goes stale during in-app navigation, so fetch
  // the watch page itself and read the genre the server rendered into it.
  async function checkYoutubeGenre() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname) || location.pathname !== '/watch') return;
    const videoId = new URLSearchParams(location.search).get('v');
    if (!videoId) return;
    let genre = genreCache.get(videoId);
    if (genre === undefined) {
      try {
        const response = await fetch('/watch?v=' + encodeURIComponent(videoId), { credentials: 'include' });
        genre = extractYoutubeGenre(await response.text());
      } catch (e) {
        genre = null;
      }
      genreCache.set(videoId, genre);
    }
    const reason = youtubeGenreBlocked(genre, config);
    if (reason) block(reason);
  }

  function onNavigate() {
    if (blocked || location.href === lastUrl) return;
    lastUrl = location.href;
    checkUrl();
    if (!blocked) checkYoutubeGenre();
  }

  function watch() {
    onNavigate();
    document.addEventListener('yt-navigate-finish', onNavigate);
    window.addEventListener('popstate', onNavigate);
    setInterval(onNavigate, 1000);

    const scan = () => {
      if (blocked) return;
      checkPage();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scan);
    } else {
      scan();
    }
    // Re-scan when the title changes, which is how most single-page apps
    // signal a new page.
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: false });
    const titleWatcher = () => {
      const title = document.querySelector('title');
      if (title) new MutationObserver(scan).observe(title, { childList: true, characterData: true, subtree: true });
    };
    document.addEventListener('DOMContentLoaded', titleWatcher);
  }

  chrome.runtime.sendMessage({ type: 'getState' }, state => {
    if (chrome.runtime.lastError || !state || !state.active) return;
    config = state.config;
    watch();
  });
})();
