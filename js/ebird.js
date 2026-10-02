// eBird data, two ways:
//  - fromBookmarklet(): species list captured from the public bird-list page
//    by the bookmarklet (no key; only the taxonomy endpoint is called, which
//    works without one).
//  - fetchHotspot(): eBird API 2.0, needs a free key (https://ebird.org/api/keygen).
// api.ebird.org sends CORS headers, so both run straight from the browser.

const Ebird = (() => {
  const API = 'https://api.ebird.org/v2';
  const LOCALE = 'pt_BR';
  // Taxonomy categories that roll up to a species via `reportAs`.
  const ROLLUP = new Set(['issf', 'form']);

  // Accepts a hotspot URL (https://ebird.org/hotspot/L19543097/bird-list),
  // or a bare location id (L19543097).
  function parseLocId(input) {
    const m = String(input).trim().match(/\b(L\d+)\b/);
    return m ? m[1] : null;
  }

  async function get(path, key, params = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, key ? { headers: { 'x-ebirdapitoken': key } } : undefined);
    if (res.status === 403 || res.status === 401) {
      throw new Error('Chave da API do eBird inválida ou ausente.');
    }
    if (!res.ok) throw new Error(`eBird respondeu ${res.status} para ${path}`);
    return res.json();
  }

  async function taxonomy(codes, key) {
    const out = new Map();
    // The endpoint returns [] for the whole batch if any code is unknown,
    // so split empty batches until the bad code is isolated.
    const load = async (chunk) => {
      const rows = await get('/ref/taxonomy/ebird', key, {
        fmt: 'json',
        locale: LOCALE,
        species: chunk.join(','),
      });
      if (!rows.length && chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2);
        await load(chunk.slice(0, mid));
        await load(chunk.slice(mid));
      }
      for (const r of rows) out.set(r.speciesCode, r);
    };
    const unique = [...new Set(codes)];
    for (let i = 0; i < unique.length; i += 150) await load(unique.slice(i, i + 150));
    return out;
  }

  // Maps any taxon code to its species-level code, or null for taxa that
  // don't count as a species (spuh, slash, hybrid, domestic…).
  function toSpecies(code, tax) {
    const t = tax.get(code);
    if (!t) return null;
    if (t.category === 'species') return code;
    if (ROLLUP.has(t.category) && t.reportAs) return t.reportAs;
    return null;
  }

  // Runs `fn` over `items` with at most `limit` in flight, yielding results
  // in input order so the caller can stop early.
  async function* ordered(items, limit, fn) {
    const pending = [];
    let next = 0;
    const launch = () => {
      if (next < items.length) pending.push(fn(items[next++]).catch((e) => ({ error: e })));
    };
    for (let i = 0; i < limit; i++) launch();
    while (pending.length) {
      const r = await pending.shift();
      launch();
      yield r;
    }
  }

  // The recent-checklists feed reports dates as "4 Jun 2020" + "07:15";
  // newer responses also carry an ISO `isoObsDate`.
  function checklistDate(l) {
    const iso = l.isoObsDate && Date.parse(l.isoObsDate.replace(' ', 'T'));
    if (iso) return iso;
    return Date.parse(`${l.obsDt} ${l.obsTime || '00:00'}`) || 0;
  }

  function isoDay(ms) {
    if (!ms) return null;
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatName(comName) {
    // pt-BR bird names are lowercase in CBRO style ("sabiá-laranjeira").
    return comName ? comName.charAt(0).toLowerCase() + comName.slice(1) : comName;
  }

  /**
   * Fetches everything the zine needs for a hotspot.
   * Returns { locId, name, totalSpecies, species: [{code, comName, sciName,
   * taxonOrder, lastSeen}] } with up to `max` species, most recent first.
   */
  async function fetchHotspot(locId, key, { max = 84, onProgress = () => {} } = {}) {
    onProgress('Buscando informações do hotspot…');
    const [info, spplist] = await Promise.all([
      get(`/ref/hotspot/info/${locId}`, key),
      get(`/product/spplist/${locId}`, key),
    ]);

    onProgress(`Carregando taxonomia (${spplist.length} táxons)…`);
    const tax = await taxonomy(spplist, key);
    const rollups = [...tax.values()]
      .filter((t) => ROLLUP.has(t.category) && t.reportAs && !tax.has(t.reportAs))
      .map((t) => t.reportAs);
    if (rollups.length) for (const [k, v] of await taxonomy(rollups, key)) tax.set(k, v);

    const allSpecies = new Set(spplist.map((c) => toSpecies(c, tax)).filter(Boolean));
    let target = Math.min(max, allSpecies.size);

    onProgress('Buscando checklists recentes…');
    const lists = await get(`/product/lists/${locId}`, key, { maxResults: 200 });
    for (const l of lists) l.when = checklistDate(l);
    lists.sort((a, b) => b.when - a.when);

    // Walk checklists newest → oldest, recording each species the first time
    // it shows up, until we have enough.
    const lastSeen = new Map();
    let done = 0;
    for await (const cl of ordered(lists, 4, (l) => get(`/product/checklist/view/${l.subId}`, key))) {
      done++;
      if (cl.error) continue;
      const date = isoDay(lists[done - 1].when);
      const obs = cl.obs || [];
      // Codes missing from spplist (rare, e.g. after a taxonomy update).
      const unknown = obs.map((o) => o.speciesCode).filter((c) => !tax.has(c));
      if (unknown.length) {
        for (const [k, v] of await taxonomy(unknown, key)) tax.set(k, v);
      }
      for (const o of obs) {
        const sp = toSpecies(o.speciesCode, tax);
        if (!sp) continue;
        allSpecies.add(sp);
        if (!lastSeen.has(sp)) lastSeen.set(sp, date);
      }
      onProgress(`Lendo checklists: ${done}/${lists.length} — ${lastSeen.size}/${target} espécies`);
      if (lastSeen.size >= target) break;
    }

    target = Math.min(max, allSpecies.size);
    // Not enough recent checklists to cover every species: append the rest
    // of the hotspot list (taxonomic order, no date).
    const picked = [...lastSeen.keys()];
    if (picked.length < target) {
      const rest = [...allSpecies]
        .filter((c) => !lastSeen.has(c))
        .sort((a, b) => tax.get(a).taxonOrder - tax.get(b).taxonOrder);
      picked.push(...rest.slice(0, target - picked.length));
    }

    const species = picked.slice(0, target).map((code) => {
      const t = tax.get(code);
      return {
        code,
        comName: formatName(t.comName),
        sciName: t.sciName,
        taxonOrder: t.taxonOrder,
        lastSeen: lastSeen.get(code) || null,
      };
    });

    return { locId, name: info.name, totalSpecies: allSpecies.size, species };
  }

  /**
   * Builds the hotspot data from a bookmarklet payload ({locId, name,
   * species: [[code, sciName, englishName, 'YYYY-MM-DD']]}, taxonomic order),
   * translating names to pt-BR.
   */
  async function fromBookmarklet(payload, { onProgress = () => {} } = {}) {
    onProgress('Traduzindo nomes para português…');
    let tax = new Map();
    try {
      tax = await taxonomy(payload.species.map((r) => r[0]));
    } catch (e) {
      console.warn('taxonomia indisponível; usando nomes da página', e);
    }
    const species = payload.species.map(([code, sciName, comName, lastSeen], i) => ({
      code,
      comName: formatName(tax.get(code)?.comName || comName),
      sciName,
      taxonOrder: tax.get(code)?.taxonOrder ?? i,
      lastSeen: lastSeen || null,
    }));
    return {
      locId: payload.locId,
      name: payload.name,
      totalSpecies: species.length,
      species: byRecency(species),
    };
  }

  // Most recently seen first; ties (same checklist) keep taxonomic order.
  function byRecency(species) {
    return [...species].sort((a, b) =>
      (b.lastSeen || '').localeCompare(a.lastSeen || '') || a.taxonOrder - b.taxonOrder);
  }

  return { parseLocId, fetchHotspot, fromBookmarklet };
})();
