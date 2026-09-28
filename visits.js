// Counts page views, key clicks, and reading time for the private /insights dashboard.
// No cookies. Open any page with ?no-insights to stop counting your own visits in this browser
// (?insights-on undoes it). Only runs on dipops.com unless a test endpoint is set in localStorage.
(() => {
  'use strict';
  const OPT_OUT = 'dipops:no-insights';
  const TEST_ENDPOINT = 'dipops:insights-endpoint';
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* Storage may be unavailable. */ } }
  };
  const params = new URLSearchParams(location.search);
  if (params.has('no-insights')) storage.set(OPT_OUT, '1');
  if (params.has('insights-on')) storage.set(OPT_OUT, null);

  const endpoint = storage.get(TEST_ENDPOINT) || (/(^|\.)dipops\.com$/.test(location.hostname) ? '/api/ping' : null);
  if (!endpoint || storage.get(OPT_OUT) === '1' || navigator.webdriver || navigator.globalPrivacyControl === true) return;

  function send(event) {
    const body = JSON.stringify({ p: location.pathname, l: navigator.language, ...event });
    try { if (navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return; } catch { /* Fall back to fetch. */ }
    try { fetch(endpoint, { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => {}); } catch { /* Counting is best effort. */ }
  }

  const utm = {};
  for (const key of ['source', 'medium', 'campaign']) {
    const value = params.get(`utm_${key}`);
    if (value) utm[key] = value.slice(0, 60);
  }
  send({ t: 'pageview', r: document.referrer, u: utm });

  function actionFor(link) {
    if (link.dataset.insights) return link.dataset.insights;
    if (/\/resume\.pdf$/i.test(link.pathname)) return 'resume';
    if (link.protocol === 'mailto:') return 'email';
    if (link.host === location.host) return null;
    if (/(^|\.)github\.com$/.test(link.hostname)) return 'github';
    if (/(^|\.)linkedin\.com$/.test(link.hostname)) return 'linkedin';
    return /^https?:$/.test(link.protocol) ? 'outbound' : null;
  }
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const action = link && actionFor(link);
    if (action) send({ t: 'action', a: action, h: link.href });
  }, true);

  let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  let visibleTotal = 0;
  function reportTime() {
    if (visibleSince !== null) visibleTotal += Date.now() - visibleSince;
    visibleSince = null;
    const seconds = Math.round(visibleTotal / 1000);
    visibleTotal = 0;
    if (seconds >= 1) send({ t: 'engage', s: Math.min(seconds, 1800) });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reportTime();
    else visibleSince = Date.now();
  });
  addEventListener('pagehide', reportTime);
})();
