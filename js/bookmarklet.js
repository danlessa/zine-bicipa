// Bookmarklet that runs on ebird.org, so no API key is needed: the public
// hotspot "bird list" page already carries every species with its last-seen
// date, but browsers won't let this app read ebird.org directly (no CORS).
//
// It reads that data (from the current page, or by fetching the bird-list
// page same-origin) and opens the app with it in the URL hash:
//   <app>#ebird=<JSON {v, locId, name, species: [[code, sci, name, date]]}>
//
// `run` is serialized with Function.prototype.toString, so it must be
// self-contained and use only block comments.

const Bookmarklet = (() => {
  function run(appUrl) {
    /* eslint-disable no-var */
    var m = /(^|\.)ebird\.org$/.test(location.hostname) && location.pathname.match(/\/hotspot\/(L\d+)/);
    if (!m) {
      alert('Zine Bicipá: abra a página de um hotspot no eBird (ebird.org/hotspot/L…) e clique de novo.');
      return;
    }
    var locId = m[1];
    /* Open the tab now, while we still have the click's user activation. */
    var win = window.open('about:blank', '_blank');

    function findBins(nuxt) {
      var f = nuxt && nuxt.fetch;
      for (var k in f || {}) if (f[k] && f[k].binnedBirdList) return f[k].binnedBirdList;
      return null;
    }

    function fetchBins() {
      return fetch('/hotspot/' + locId + '/bird-list', { credentials: 'include' })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var s = html.match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/);
          if (!s) throw new Error('não encontrei a lista na página do eBird (o formato pode ter mudado).');
          /* ebird.org's CSP allows inline scripts but not eval(). */
          var el = document.createElement('script');
          el.textContent = 'window.__ZINE_NUXT__=' + s[1];
          document.head.appendChild(el);
          el.remove();
          var bins = findBins(window.__ZINE_NUXT__);
          delete window.__ZINE_NUXT__;
          if (!bins) throw new Error('não encontrei a lista na página do eBird (o formato pode ter mudado).');
          return bins;
        });
    }

    var nuxt = window.__NUXT__;
    var onThisList = nuxt && String(nuxt.routePath || '').indexOf('/hotspot/' + locId + '/bird-list') === 0;
    Promise.resolve((onThisList && findBins(nuxt)) || fetchBins())
      .then(function (bins) {
        var rows = (bins.nativeNaturalized || []).concat(bins.provisional || []);
        if (!rows.length) throw new Error('a lista deste hotspot está vazia.');
        var payload = {
          v: 1,
          locId: locId,
          name: rows[0].locName || document.title.split(' - ')[1] || locId,
          species: rows.map(function (r) {
            return [r.speciesCode, r.sciName, r.commonName, String(r.isoObsDate || '').slice(0, 10)];
          }),
        };
        var url = appUrl + '#ebird=' + encodeURIComponent(JSON.stringify(payload));
        if (win) win.location.href = url; else location.href = url;
      })
      .catch(function (e) {
        if (win) win.close();
        alert('Zine Bicipá: ' + (e && e.message || e));
      });

  }

  function href(appUrl) {
    // Percent-encoded because browsers percent-decode javascript: URLs.
    return 'javascript:' + encodeURIComponent(`(${run.toString()})(${JSON.stringify(appUrl)});void 0`);
  }

  // Returns the payload carried in the URL hash, or null.
  function readPayload(hash = location.hash) {
    const m = hash.match(/^#ebird=(.+)$/);
    if (!m) return null;
    const data = JSON.parse(decodeURIComponent(m[1]));
    if (data?.v !== 1 || !Array.isArray(data.species)) throw new Error('Dados do favorito inválidos.');
    return data;
  }

  return { href, readPayload };
})();
