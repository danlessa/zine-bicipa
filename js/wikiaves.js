// App side of the Wikiaves bridge. The app can't read wikiaves.com.br itself
// (no CORS), so it opens a Wikiaves tab where the user clicks the bookmarklet;
// that tab then answers our postMessage requests (see js/bookmarklet.js).
//
// Photos by Wikiaves users are all rights reserved: the collective must get
// each photographer's permission before printing. photographers() helps
// with that.

const Wikiaves = (() => {
  const ORIGIN = 'https://www.wikiaves.com.br';
  const CANDIDATES = 8;

  let tab = null; // the Wikiaves window, once its bookmarklet says hello
  const listeners = new Set();
  const pendingBlobs = new Map(); // url → {resolve, reject}

  window.addEventListener('message', (ev) => {
    if (ev.origin !== ORIGIN || !ev.data?.type) return;
    tab = ev.source;
    const msg = ev.data;
    if (msg.type === 'zine:blob') {
      const p = pendingBlobs.get(msg.url);
      pendingBlobs.delete(msg.url);
      if (p) msg.blob ? p.resolve(msg.blob) : p.reject(new Error(msg.error || 'falha ao baixar a foto'));
      return;
    }
    for (const fn of listeners) fn(msg);
  });

  function open() {
    window.open(`${ORIGIN}/`, 'zine-wikiaves');
  }

  function connected() {
    return !!tab && !tab.closed;
  }

  function send(msg) {
    if (!connected()) {
      throw new Error('A aba do Wikiaves não está conectada. Clique em "Abrir Wikiaves" e depois no favorito Zine Bicipá nessa aba.');
    }
    tab.postMessage(msg, ORIGIN);
  }

  // Receives 'zine:hello' (bookmarklet ready), 'zine:photo' and 'zine:done'.
  function onMessage(fn) {
    listeners.add(fn);
  }

  function requestPhotos(species) {
    send({
      type: 'zine:species',
      max: CANDIDATES,
      species: species.map((sp) => ({ key: sp.code, sciName: sp.sciName, comName: sp.comName })),
    });
  }

  function tellIdle() {
    if (connected()) tab.postMessage({ type: 'zine:idle' }, ORIGIN);
  }

  function fetchBlob(url) {
    send({ type: 'zine:fetch', url });
    return new Promise((resolve, reject) => pendingBlobs.set(url, { resolve, reject }));
  }

  // Bookmarklet result → photo used by the zine (null when none found).
  function toPhoto(candidates, index, blob) {
    const c = candidates[index];
    if (!c) return null;
    return {
      source: 'wikiaves',
      url: c.url,
      thumb: c.thumb,
      author: c.author,
      perfil: c.perfil,
      page: `${ORIGIN}/${c.id}`,
      blob,
      candidates,
      index,
    };
  }

  // Swaps to another candidate photo of the same species.
  async function choose(photo, index) {
    const blob = await fetchBlob(photo.candidates[index].url);
    return toPhoto(photo.candidates, index, blob);
  }

  // [{author, perfil, profile, count}] for the photos in use.
  function photographers(photos) {
    const byAuthor = new Map();
    for (const p of photos) {
      if (p?.source !== 'wikiaves') continue;
      const entry = byAuthor.get(p.perfil) ||
        { author: p.author, perfil: p.perfil, profile: `${ORIGIN}/perfil_${p.perfil}`, count: 0 };
      entry.count++;
      byAuthor.set(p.perfil, entry);
    }
    return [...byAuthor.values()].sort((a, b) => b.count - a.count || a.author.localeCompare(b.author));
  }

  return { open, connected, onMessage, requestPhotos, tellIdle, toPhoto, choose, photographers };
})();
