(function () {
  'use strict';

  var lastUrl = null;
  var apiBase = '';
  try {
    var meta = document.querySelector('meta[name="api-base"]');
    apiBase = meta && meta.getAttribute('content') ? meta.getAttribute('content').trim() : '';
  } catch (err) {
    apiBase = '';
  }
  if (apiBase) {
    apiBase = apiBase.replace(/\/+$/, '');
  }
  var pushEndpoint = (apiBase || '') + '/api/push';

  function normalizeUrl() {
    try {
      var canonical = document.querySelector('link[rel="canonical"][href]');
      var raw = canonical && canonical.href ? canonical.href : window.location.href;
      var noHash = raw.split('#')[0];
      return new URL(noHash, window.location.origin).toString();
    } catch (e) {
      try {
        return window.location.origin + window.location.pathname;
      } catch (err) {
        return window.location.href;
      }
    }
  }

  function sendJson(endpoint, payload) {
    var json = JSON.stringify(payload);
    if (window.fetch) {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: json,
        credentials: 'same-origin'
      }).catch(function () {});
      return;
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
      xhr.send(json);
    } catch (err) {
      // ignore
    }
  }

  function pushOnce() {
    try {
      var url = normalizeUrl();
      if (!url || url === lastUrl) {
        return;
      }
      lastUrl = url;
      sendJson(pushEndpoint, { url: url });
    } catch (err) {
      // ignore
    }
  }

  function hookHistory() {
    if (typeof history !== 'undefined') {
      var originalPush = history.pushState;
      if (originalPush) {
        history.pushState = function () {
          var ret = originalPush.apply(this, arguments);
          setTimeout(pushOnce, 0);
          return ret;
        };
      }
      var originalReplace = history.replaceState;
      if (originalReplace) {
        history.replaceState = function () {
          var ret = originalReplace.apply(this, arguments);
          setTimeout(pushOnce, 0);
          return ret;
        };
      }
    }
    window.addEventListener('popstate', function () { setTimeout(pushOnce, 0); });
    window.addEventListener('hashchange', function () { setTimeout(pushOnce, 0); });
  }

  function init() {
    hookHistory();
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(pushOnce, 0);
    } else {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(pushOnce, 0); });
    }
  }

  init();
})();
