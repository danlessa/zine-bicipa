// Bookmarklet that does the cross-site reads this static app can't do itself
// (browsers block reading ebird.org / wikiaves.com.br from another origin, and
// neither site opts in via CORS). Running inside those sites, it can.
//
// On ebird.org: reads the hotspot bird list (every species + last-seen date,
// from the current page or by fetching the bird-list page same-origin) and
// opens the app with it in the URL hash:
//   <app>#ebird=<JSON {v, locId, name, species: [[code, sci, name, date]]}>
//
// On www.wikiaves.com.br (a tab opened by the app's "Abrir Wikiaves" button):
// talks to the app through postMessage. The app sends the species; the
// bookmarklet looks up each one's top photos and sends back their metadata
// plus the image bytes (Wikiaves' image bucket only allows CORS reads from
// www.wikiaves.com.br itself). It keeps listening so the app can ask for
// other photos.
//
// `run` is serialized with Function.prototype.toString, so it must be
// self-contained and use only block comments.

const Bookmarklet = (() => {
  function run(appUrl) {
    /* eslint-disable no-var */
    var appOrigin = new URL(appUrl).origin;
    if (/(^|\.)wikiaves\.com\.br$/.test(location.hostname)) {
      wikiaves();
      return;
    }
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

    function wikiaves() {
      if (location.hostname !== 'www.wikiaves.com.br') {
        location.href = 'https://www.wikiaves.com.br/';
        return;
      }
      if (!window.opener) {
        alert('Zine Bicipá: abra o Wikiaves pelo botão "Abrir Wikiaves" no app do zine e clique no favorito nessa aba.');
        return;
      }
      if (window.__zineBicipa) {
        window.opener.postMessage({ type: 'zine:hello' }, appOrigin);
        return;
      }
      window.__zineBicipa = true;

      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;max-width:340px;' +
        'padding:12px 16px;background:#7843e6;color:#fff;font:14px/1.4 system-ui,sans-serif;' +
        'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      document.body.appendChild(box);
      var say = function (t) { box.textContent = 'Zine Bicipá: ' + t; };
      say('conectando ao app…');
      var silent = setTimeout(function () {
        say('o app não respondeu. Abra o Wikiaves pelo botão do app e clique no favorito de novo.');
      }, 8000);

      /* Retries with backoff: Wikiaves sometimes drops bursts of requests. */
      var retry = function (fn, tries, delay) {
        return fn().catch(function (e) {
          if (tries <= 1) throw e;
          return new Promise(function (ok) { setTimeout(ok, delay); })
            .then(function () { return retry(fn, tries - 1, delay * 2); });
        });
      };
      var getJson = function (path) {
        return retry(function () {
          return fetch(path).then(function (r) {
            if (!r.ok) throw new Error('Wikiaves respondeu ' + r.status);
            return r.json();
          });
        }, 5, 1000);
      };
      var getBlob = function (url) {
        return retry(function () {
          return fetch(url, { mode: 'cors' }).then(function (r) {
            if (!r.ok) throw new Error('imagem ' + r.status);
            return r.blob();
          });
        }, 5, 1000);
      };
      var lower = function (x) { return String(x || '').toLowerCase(); };

      /* Scientific name first; Portuguese name covers taxonomy differences. */
      var findTaxon = function (sp) {
        var terms = [sp.sciName, sp.comName];
        var attempt = function (i) {
          if (i >= terms.length) return null;
          return getJson('/getTaxonsJSON.php?term=' + encodeURIComponent(terms[i])).then(function (list) {
            var hit = (list || []).filter(function (t) {
              return String(t.sp) === '1' &&
                (lower(t.label) === lower(sp.sciName) || lower(t.nome) === lower(sp.comName));
            })[0];
            return hit || attempt(i + 1);
          });
        };
        return attempt(0);
      };

      var topPhotos = function (taxon, max) {
        return getJson('/getRegistrosJSON.php?tm=f&t=s&s=' + taxon.id + '&o=mp&p=1').then(function (data) {
          var items = (data && data.registros && data.registros.itens) || {};
          return Object.keys(items).map(function (k) { return items[k]; })
            .filter(function (r) { return r.tipo === 'F' && !r.is_questionada && r.link; })
            .slice(0, max)
            .map(function (r) {
              return {
                id: r.id, author: r.autor, perfil: r.perfil,
                url: r.link.replace('#', ''), thumb: r.link.replace('#', 'q'),
              };
            });
        });
      };

      var lookup = function (sp, max) {
        return findTaxon(sp).then(function (taxon) {
          if (!taxon) return { key: sp.key, candidates: [] };
          return topPhotos(taxon, max).then(function (c) {
            if (!c.length) return { key: sp.key, candidates: c };
            return getBlob(c[0].url).then(function (blob) {
              return { key: sp.key, candidates: c, blob: blob };
            });
          });
        }).catch(function (e) {
          return { key: sp.key, candidates: [], error: String((e && e.message) || e) };
        });
      };

      window.addEventListener('message', function (ev) {
        if (ev.origin !== appOrigin || !ev.data) return;
        var msg = ev.data;
        var reply = function (r) { ev.source.postMessage(r, appOrigin); };
        clearTimeout(silent);
        if (msg.type === 'zine:species') {
          var list = msg.species || [];
          var next = 0;
          var done = 0;
          say('buscando fotos… 0/' + list.length);
          var worker = function () {
            if (next >= list.length) return Promise.resolve();
            var sp = list[next++];
            return lookup(sp, msg.max || 8).then(function (r) {
              r.type = 'zine:photo';
              reply(r);
              say('buscando fotos… ' + (++done) + '/' + list.length + ' — mantenha esta aba aberta');
              return worker();
            });
          };
          Promise.all([worker(), worker()]).then(function () {
            reply({ type: 'zine:done' });
            say('fotos enviadas ao app ✔ Deixe esta aba aberta para poder trocar fotos.');
          });
        } else if (msg.type === 'zine:fetch') {
          getBlob(msg.url).then(function (blob) {
            reply({ type: 'zine:blob', url: msg.url, blob: blob });
          }).catch(function (e) {
            reply({ type: 'zine:blob', url: msg.url, error: String((e && e.message) || e) });
          });
        } else if (msg.type === 'zine:idle') {
          say('todas as fotos já estão no app ✔');
        }
      });
      window.opener.postMessage({ type: 'zine:hello' }, appOrigin);
    }
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
