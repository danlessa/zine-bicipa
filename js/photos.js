// Species photos from iNaturalist: its API and image bucket send CORS
// headers (needed to draw photos into the PDF), and we only use photos
// under Creative Commons licenses, so the zine can be printed and shared
// with attribution alone. Also crops/rotates images for the PDF.

const Photos = (() => {
  const API = 'https://api.inaturalist.org/v1';
  const AVES_TAXON_ID = 3;
  const CANDIDATES = 8;
  const CACHE_KEY = 'zine-bicipa:inat-photos:v3';
  // iNaturalist asks API clients to stay around 1 request/second.
  const MIN_INTERVAL_MS = 1000;

  let lastCall = 0;
  async function throttledJson(url) {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    lastCall = Date.now() + Math.max(0, wait);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`iNaturalist respondeu ${res.status}`);
    return res.json();
  }

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
  }
  function saveCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota/private mode */ }
  }

  // "(c) Dario Sanches, some rights reserved (CC BY-SA)" → "Dario Sanches"
  function authorFromAttribution(attr = '') {
    const m = attr.match(/^\(c\)\s*(.*?),\s*(some|all|no) rights/i);
    return m ? m[1] : attr;
  }

  // iNat photo → candidate, or null unless it has a CC license.
  function toCandidate(photo) {
    if (!photo?.license_code || !photo.url) return null;
    return {
      id: photo.id,
      url: photo.medium_url || photo.url.replace('/square.', '/medium.'),
      thumb: photo.square_url || photo.url,
      author: photo.attribution_name || authorFromAttribution(photo.attribution),
      license: photo.license_code,
    };
  }

  async function findTaxon(sciName) {
    const url = `${API}/taxa?q=${encodeURIComponent(sciName)}&taxon_id=${AVES_TAXON_ID}` +
      '&rank=species,subspecies&is_active=true&per_page=10';
    const { results = [] } = await throttledJson(url);
    const lower = sciName.toLowerCase();
    // iNat may file the species under another genus and only match the old
    // name as the nominate subspecies ("Bubulcus ibis" → "Bubulcus ibis ibis").
    const nominate = `${lower} ${lower.split(' ').pop()}`;
    const matched = (t) => (t.matched_term || '').toLowerCase();
    return results.find((t) => t.name.toLowerCase() === lower)
      || results.find((t) => matched(t) === lower)
      || results.find((t) => t.rank === 'species' && matched(t) === nominate)
      || null;
  }

  // taxon id → CC-licensed candidates (default photo first), batched.
  async function galleries(taxa) {
    const out = new Map();
    for (let i = 0; i < taxa.length; i += 30) {
      const chunk = taxa.slice(i, i + 30);
      const { results = [] } = await throttledJson(`${API}/taxa/${chunk.map((t) => t.id).join(',')}`);
      for (const t of results) {
        const photos = [t.default_photo, ...(t.taxon_photos || []).map((tp) => tp.photo)];
        const seen = new Set();
        out.set(t.id, photos.map(toCandidate).filter((c) => c && !seen.has(c.id) && seen.add(c.id))
          .slice(0, CANDIDATES));
      }
    }
    return out;
  }

  function toPhoto(candidates, index = 0) {
    const c = candidates?.[index];
    if (!c) return null;
    return { ...c, page: `https://www.inaturalist.org/photos/${c.id}`, candidates, index };
  }

  /**
   * Resolves photos for each species. Returns a Map code → photo ({url,
   * thumb, author, license, page, candidates, index}) or null if none.
   */
  async function lookup(species, { onProgress = () => {} } = {}) {
    const cache = loadCache();
    const todo = species.filter((sp) => !(sp.sciName in cache));
    const found = [];
    for (const [i, sp] of todo.entries()) {
      onProgress(`Buscando fotos no iNaturalist: ${i + 1}/${todo.length} (${sp.comName})`);
      try {
        const taxon = await findTaxon(sp.sciName);
        if (taxon) found.push({ sp, taxon });
        else cache[sp.sciName] = [];
      } catch (e) {
        console.warn('iNaturalist', sp.sciName, e);
      }
    }
    if (found.length) {
      onProgress('Buscando galerias de fotos no iNaturalist…');
      const byTaxon = await galleries(found.map((f) => f.taxon));
      for (const { sp, taxon } of found) cache[sp.sciName] = byTaxon.get(taxon.id) || [];
    }
    saveCache(cache);
    return new Map(species.map((sp) => [sp.code, toPhoto(cache[sp.sciName])]));
  }

  /**
   * Returns the photo as a JPEG data URL center-cropped to the requested
   * aspect ratio (width / height), at most `maxPx` wide.
   */
  const cropped = new Map();
  async function croppedDataUrl(photo, aspect, maxPx = 400) {
    const key = `${photo.url}|${aspect.toFixed(3)}|${maxPx}`;
    if (!cropped.has(key)) {
      const p = crop(photo.url, aspect, maxPx);
      cropped.set(key, p);
      p.catch(() => cropped.delete(key));
    }
    return cropped.get(key);
  }

  async function crop(url, aspect, maxPx) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`imagem ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    let sw = bmp.width;
    let sh = bmp.height;
    if (sw / sh > aspect) sw = sh * aspect; else sh = sw / aspect;
    const sx = (bmp.width - sw) / 2;
    const sy = (bmp.height - sh) / 2;
    const w = Math.round(Math.min(maxPx, sw));
    const h = Math.round(w / aspect);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    bmp.close?.();
    return canvas.toDataURL('image/jpeg', 0.88);
  }

  // Same image turned upside down, for the zine's upside-down panels.
  const turned = new Map();
  function rotated180(dataUrl) {
    if (!turned.has(dataUrl)) {
      turned.set(dataUrl, (async () => {
        const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const g = canvas.getContext('2d');
        g.translate(bmp.width, bmp.height);
        g.rotate(Math.PI);
        g.drawImage(bmp, 0, 0);
        bmp.close?.();
        return canvas.toDataURL('image/jpeg', 0.9);
      })());
    }
    return turned.get(dataUrl);
  }

  // "cc-by-nc-sa" → "CC BY-NC-SA", "cc0" → "CC0"
  function licenseLabel(code) {
    if (!code) return null;
    if (code === 'cc0') return 'CC0';
    return 'CC ' + code.replace(/^cc-/, '').toUpperCase();
  }

  return { lookup, toPhoto, croppedDataUrl, rotated180, licenseLabel };
})();
