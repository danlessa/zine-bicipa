// UI wiring: get the hotspot's species (bookmarklet or eBird API), get
// Wikiaves photos through the bookmarklet bridge, let the user tweak the
// cover texts, then render the PDF into the preview.

(() => {
  const KEY_STORAGE = 'zine-bicipa:ebird-key';
  const $ = (id) => document.getElementById(id);

  const state = {
    hotspot: null, // .species holds every candidate, most recently seen first
    photos: new Map(), // code → Wikiaves photo | null (none found)
    pdfUrl: null, // imposed A4 sheet
    pagesUrl: null, // 16 A7 pages in reading order
  };

  function store(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
  function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

  function setStatus(msg, isError = false) {
    $('status').textContent = msg;
    $('status').classList.toggle('error', isError);
  }

  function titleText() {
    const place = Place.stripArticle($('place').value.trim());
    return `As aves ${$('prep').value} ${place}`;
  }

  function maxSpecies() {
    return Math.max(1, Math.min(Zine.MAX_SPECIES, Number($('max').value) || Zine.MAX_SPECIES));
  }

  // The N most recently seen species, in the order chosen by the user,
  // each with `photo` set.
  function selectedSpecies() {
    const list = state.hotspot.species.slice(0, maxSpecies());
    if ($('order').value === 'taxonomic') list.sort((a, b) => a.taxonOrder - b.taxonOrder);
    for (const sp of list) sp.photo = state.photos.get(sp.code) || null;
    return list;
  }

  function missingWikiaves() {
    return state.hotspot.species.slice(0, maxSpecies())
      .filter((sp) => !state.photos.has(sp.code));
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ── Species table & photographers ─────────────────────────────────────

  function photoCell(sp) {
    const p = sp.photo;
    if (!p) return '<span class="nophoto">sem foto</span>';
    let html = `<img src="${escapeHtml(p.thumb || p.url)}" alt="" loading="lazy">`;
    if (p.candidates.length > 1) {
      const thumbs = p.candidates.map((c, i) =>
        `<button type="button" class="cand${i === p.index ? ' current' : ''}" data-code="${escapeHtml(sp.code)}" data-index="${i}" title="${escapeHtml(c.author)}">` +
        `<img src="${escapeHtml(c.thumb)}" alt="Foto de ${escapeHtml(c.author)}" loading="lazy"></button>`).join('');
      html += `<details class="swap"><summary>trocar</summary><div class="cands">${thumbs}</div></details>`;
    }
    return html;
  }

  function creditCell(sp) {
    const p = sp.photo;
    if (!p) return '';
    return `<a href="${escapeHtml(p.page)}" target="_blank" rel="noopener">${escapeHtml(p.author)}</a>`;
  }

  function renderSpeciesTable(species) {
    const missing = species.filter((s) => !s.photo).length;
    $('species-summary').textContent =
      `${species.length} espécies no zine (de ${state.hotspot.totalSpecies} registradas no hotspot)` +
      (missing ? ` · ${missing} sem foto` : '');
    $('species-body').replaceChildren(...species.map((sp, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i + 1}</td><td class="photo">${photoCell(sp)}</td>` +
        `<td><strong>${escapeHtml(sp.comName)}</strong><br><span class="sci">${escapeHtml(sp.sciName)}</span></td>` +
        `<td>${formatDate(sp.lastSeen)}</td><td>${creditCell(sp)}</td>`;
      return tr;
    }));
    renderPhotographers(species);
    $('step-species').hidden = false;
  }

  function renderPhotographers(species) {
    const people = Wikiaves.photographers(species.map((sp) => sp.photo));
    $('photographers').hidden = !people.length;
    $('photographers-count').textContent = people.length;
    $('photographers-list').replaceChildren(...people.map((p) => {
      const li = document.createElement('li');
      li.innerHTML = `<a href="${escapeHtml(p.profile)}" target="_blank" rel="noopener">${escapeHtml(p.author)}</a>` +
        ` — ${p.count} ${p.count === 1 ? 'foto' : 'fotos'}`;
      return li;
    }));
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  async function busy(button, fn) {
    if (button) button.disabled = true;
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function updateWikiavesUi() {
    $('step-wikiaves').hidden = !state.hotspot;
    if (!state.hotspot) return;
    const total = Math.min(maxSpecies(), state.hotspot.species.length);
    const got = total - missingWikiaves().length;
    $('wikiaves-progress').textContent = Wikiaves.connected()
      ? `Aba do Wikiaves conectada · ${got}/${total} espécies verificadas.`
      : `${got}/${total} espécies verificadas.`;
  }

  async function render() {
    const missing = missingWikiaves();
    if (missing.length && Wikiaves.connected()) {
      // The PDF is rendered again when the bookmarklet reports 'zine:done'.
      Wikiaves.requestPhotos(missing);
      setStatus(`Buscando ${missing.length} fotos no Wikiaves… mantenha a aba do Wikiaves aberta.`);
      updateWikiavesUi();
      return;
    }
    updateWikiavesUi();

    const species = selectedSpecies();
    renderSpeciesTable(species);
    const title = titleText();
    const { sheet, pages } = await Zine.render(
      { ...state.hotspot, species },
      {
        title,
        phrase: $('phrase').value.trim(),
        handle: $('handle').value.trim(),
        onProgress: setStatus,
      },
    );
    for (const url of [state.pdfUrl, state.pagesUrl]) if (url) URL.revokeObjectURL(url);
    state.pdfUrl = URL.createObjectURL(sheet.output('blob'));
    state.pagesUrl = URL.createObjectURL(pages.output('blob'));
    $('preview').src = state.pdfUrl;
    $('download').href = state.pdfUrl;
    $('download').download = `zine-${slug(title)}.pdf`;
    $('download-pages').href = state.pagesUrl;
    $('download-pages').download = `zine-${slug(title)}-paginas-a7.pdf`;
    $('step-pdf').hidden = false;
    const noPhoto = species.filter((sp) => !sp.photo).length;
    if (missingWikiaves().length) {
      setStatus('Para buscar as fotos, clique em "Abrir Wikiaves" e depois no favorito Zine Bicipá nessa aba.');
    } else {
      setStatus(noPhoto ? `PDF pronto (${noPhoto} espécies sem foto).` : 'PDF pronto.');
    }
  }

  // ── Wikiaves bridge ───────────────────────────────────────────────────

  let received = 0;
  const wikiavesErrors = new Map(); // code → failed attempts
  Wikiaves.onMessage((msg) => {
    if (!state.hotspot) return;
    if (msg.type === 'zine:hello') {
      received = 0;
      const missing = missingWikiaves();
      if (missing.length) {
        Wikiaves.requestPhotos(missing);
        setStatus(`Wikiaves conectado. Buscando ${missing.length} fotos…`);
      } else {
        Wikiaves.tellIdle();
        setStatus('Wikiaves conectado.');
      }
      updateWikiavesUi();
    } else if (msg.type === 'zine:photo') {
      if (msg.error) {
        // Leave it missing so it's requested again (a couple of times at most).
        console.warn('Wikiaves', msg.key, msg.error);
        const tries = (wikiavesErrors.get(msg.key) || 0) + 1;
        wikiavesErrors.set(msg.key, tries);
        if (tries >= 3) state.photos.set(msg.key, null);
      } else {
        state.photos.set(msg.key,
          msg.candidates?.length ? Wikiaves.toPhoto(msg.candidates, 0, msg.blob) : null);
      }
      setStatus(`Recebendo fotos do Wikiaves: ${++received}…`);
      updateWikiavesUi();
    } else if (msg.type === 'zine:done') {
      busy($('render-btn'), render);
    }
  });

  function onSwapClick(ev) {
    const btn = ev.target.closest('button.cand');
    if (!btn) return;
    const { code, index } = btn.dataset;
    const current = state.photos.get(code);
    if (!current || Number(index) === current.index) return;
    busy(null, async () => {
      setStatus('Trocando foto…');
      state.photos.set(code, await Wikiaves.choose(current, Number(index)));
      await render();
    });
  }

  // ── Data sources ──────────────────────────────────────────────────────

  async function useHotspot(hotspot) {
    state.hotspot = hotspot;
    const place = Place.cleanHotspotName(hotspot.name);
    $('place').value = place;
    $('prep').value = Place.guessPreposition(place);
    updateTitlePreview();
    $('step-edit').hidden = false;
    setStatus(`${hotspot.name}: ${hotspot.totalSpecies} espécies registradas.`);
    await render();
  }

  function onFetchApi(ev) {
    ev.preventDefault();
    busy($('fetch-btn'), async () => {
      const locId = Ebird.parseLocId($('url').value);
      if (!locId) throw new Error('Não reconheci o link. Use algo como https://ebird.org/hotspot/L19543097/bird-list');
      const key = $('api-key').value.trim();
      store(KEY_STORAGE, key);
      await useHotspot(await Ebird.fetchHotspot(locId, key, {
        max: Zine.MAX_SPECIES, onProgress: setStatus,
      }));
    });
  }

  function onRender(ev) {
    ev.preventDefault();
    if (state.hotspot) busy($('render-btn'), render);
  }

  function fromHash() {
    let payload;
    try {
      payload = Bookmarklet.readPayload();
    } catch (e) {
      setStatus(e.message, true);
      return;
    }
    if (!payload) return;
    busy($('render-btn'), async () => {
      await useHotspot(await Ebird.fromBookmarklet(payload, { onProgress: setStatus }));
    });
  }

  function slug(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function updateTitlePreview() {
    $('title-preview').textContent = titleText();
  }

  function setupBookmarklet() {
    const appUrl = location.origin + location.pathname;
    $('bookmarklet').href = Bookmarklet.href(appUrl);
    $('bookmarklet').addEventListener('click', (ev) => {
      ev.preventDefault();
      setStatus('Arraste o botão para a barra de favoritos — ele só funciona dentro do eBird e do Wikiaves.');
    });
    // eBird / Wikiaves pages can't talk to or navigate to file:// pages.
    $('file-warning').hidden = location.protocol !== 'file:';
  }

  setupBookmarklet();
  $('api-key').value = load(KEY_STORAGE) || '';
  updateWikiavesUi();
  $('api-form').addEventListener('submit', onFetchApi);
  $('edit-form').addEventListener('submit', onRender);
  $('place').addEventListener('input', updateTitlePreview);
  $('prep').addEventListener('change', updateTitlePreview);
  $('open-wikiaves').addEventListener('click', () => Wikiaves.open());
  $('species-body').addEventListener('click', onSwapClick);
  window.addEventListener('hashchange', fromHash);
  fromHash();

  // Exposed for debugging / automated checks.
  window.zineApp = { state, render };
})();
