// UI wiring: get the hotspot's species (bookmarklet or eBird API), get
// iNaturalist photos, let the user tweak the cover texts, then render the
// PDF into the preview.

(() => {
  const KEY_STORAGE = 'zine-bicipa:ebird-key';
  const $ = (id) => document.getElementById(id);

  const state = {
    hotspot: null, // .species holds every candidate, most recently seen first
    photos: new Map(), // code → iNaturalist photo | null (none found)
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

  function missingPhotos() {
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

  // ── Species table ─────────────────────────────────────────────────────

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
    return `<a href="${escapeHtml(p.page)}" target="_blank" rel="noopener">${escapeHtml(p.author)}</a>` +
      ` <span class="sci">${Photos.licenseLabel(p.license) || ''}</span>`;
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
    $('step-species').hidden = false;
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

  async function render() {
    const missing = missingPhotos();
    if (missing.length) {
      for (const [code, photo] of await Photos.lookup(missing, { onProgress: setStatus })) {
        state.photos.set(code, photo);
      }
    }

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
    setStatus(noPhoto ? `PDF pronto (${noPhoto} espécies sem foto).` : 'PDF pronto.');
  }

  function onSwapClick(ev) {
    const btn = ev.target.closest('button.cand');
    if (!btn) return;
    const { code, index } = btn.dataset;
    const current = state.photos.get(code);
    if (!current || Number(index) === current.index) return;
    state.photos.set(code, Photos.toPhoto(current.candidates, Number(index)));
    busy(null, render);
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
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
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
      setStatus('Arraste o botão para a barra de favoritos — ele só funciona dentro do eBird.');
    });
    // eBird pages can't navigate to file:// pages.
    $('file-warning').hidden = location.protocol !== 'file:';
  }

  setupBookmarklet();
  $('api-key').value = load(KEY_STORAGE) || '';
  $('api-form').addEventListener('submit', onFetchApi);
  $('edit-form').addEventListener('submit', onRender);
  $('place').addEventListener('input', updateTitlePreview);
  $('prep').addEventListener('change', updateTitlePreview);
  $('species-body').addEventListener('click', onSwapClick);
  window.addEventListener('hashchange', fromHash);
  fromHash();

  // Exposed for debugging / automated checks.
  window.zineApp = { state, render };
})();
