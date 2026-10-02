// Draws the two-sided A4 zine with jsPDF, following examples/zine.pdf.
//
// Side 1 (landscape A4, 4×2 panels of A7). The top row is printed upside
// down so the sheet folds into an 8-page booklet:
//
//   ┌────────┬────────┬────────┬────────┐
//   │ pág. 6 │ pág. 5 │ pág. 4 │ pág. 3 │  ← rotated 180°
//   ├────────┼────────┼────────┼────────┤
//   │ contra │  capa  │ pág. 1 │ pág. 2 │
//   └────────┴────────┴────────┴────────┘
//
// Side 2 is a poster with one numbered photo per checklist entry; it is
// revealed when the folded zine is opened up.

const Zine = (() => {
  const W = 841.89; // A4 landscape, in pt
  const H = 595.28;
  const PW = W / 4;
  const PH = H / 2;

  const ROWS_PER_PAGE = 14;
  const CHECKLIST_PAGES = 6;
  const MAX_SPECIES = ROWS_PER_PAGE * CHECKLIST_PAGES; // 84

  const COLOR = {
    text: [0, 0, 0],
    muted: [110, 110, 110],
    guide: [217, 217, 217],
    title: [120, 67, 230], // #7843e6
    titleShadowA: [255, 0, 255],
    titleShadowB: [0, 255, 255],
    placeholder: [236, 236, 236],
  };

  // Checklist panels in reading order: [col, row, rotated].
  const CHECKLIST_SLOTS = [
    [2, 1, false], [3, 1, false],
    [3, 0, true], [2, 0, true],
    [1, 0, true], [0, 0, true],
  ];

  function registerFonts(doc) {
    const fonts = window.ZINE_ASSETS.fonts;
    const reg = (name, family, style) => {
      doc.addFileToVFS(`${name}.ttf`, fonts[name]);
      doc.addFont(`${name}.ttf`, family, style);
    };
    reg('Aileron-Regular', 'Aileron', 'normal');
    reg('Aileron-Bold', 'Aileron', 'bold');
    reg('Aileron-Italic', 'Aileron', 'italic');
    reg('Bungee-Regular', 'Bungee', 'normal');
  }

  // Drawing context for one A7 panel. Coordinates are local to the panel
  // (top-left origin, upright); rotated panels are mapped through 180°.
  function panel(doc, col, row, rotated = false) {
    const x0 = col * PW;
    const y0 = row * PH;
    const map = (x, y) => (rotated ? [x0 + PW - x, y0 + PH - y] : [x0 + x, y0 + y]);
    return {
      w: PW,
      h: PH,
      text(str, x, y) {
        const [px, py] = map(x, y);
        doc.text(str, px, py, rotated ? { angle: 180 } : undefined);
      },
      roundedRect(x, y, w, h, r, style) {
        const [px, py] = rotated ? map(x + w, y + h) : map(x, y);
        doc.roundedRect(px, py, w, h, r, r, style);
      },
      image(data, x, y, w, h) {
        if (rotated) throw new Error('images in rotated panels are not supported');
        doc.addImage(data, 'JPEG', x0 + x, y0 + y, w, h);
      },
    };
  }

  function setFont(doc, family, style, size, color = COLOR.text) {
    doc.setFont(family, style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  }

  function width(doc, family, style, size, str) {
    doc.setFont(family, style);
    doc.setFontSize(size);
    return doc.getTextWidth(str);
  }

  // Greedy word wrap.
  function wrap(doc, words, maxW, measure) {
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || measure(candidate) <= maxW) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }

  function truncate(doc, str, maxW) {
    if (doc.getTextWidth(str) <= maxW) return str;
    let s = str;
    while (s.length > 1 && doc.getTextWidth(`${s}..`) > maxW) s = s.slice(0, -1);
    return `${s.trimEnd()}..`;
  }

  function drawGuides(doc) {
    doc.setDrawColor(...COLOR.guide);
    doc.setLineWidth(0.75);
    for (let c = 1; c < 4; c++) doc.line(c * PW, 0, c * PW, H);
    doc.line(0, PH, W, PH);
  }

  // ── Front cover ──────────────────────────────────────────────────────────
  function drawFrontCover(doc, p, { title, totalSpecies, handle }) {
    const left = 17;
    const maxW = p.w - 2 * left;
    const top = 40;
    const bottom = 222;

    // "AS AVES" always gets its own line, like the template.
    const rest = title.replace(/^as aves\s+/i, '');
    const words = rest.toUpperCase().split(/\s+/).filter(Boolean);
    let size = 34;
    let lines;
    for (; size >= 14; size -= 1) {
      const measure = (s) => width(doc, 'Bungee', 'normal', size, s);
      if (words.some((w) => measure(w) > maxW) || measure('AS AVES') > maxW) continue;
      lines = ['AS AVES', ...wrap(doc, words, maxW, measure)];
      if (lines.length * size * 1.39 <= bottom - top) break;
    }
    const leading = size * 1.39;
    const blockH = (lines.length - 1) * leading + size * 0.75;
    let y = top + (bottom - top - blockH) / 2 + size * 0.75;
    const layers = [
      [COLOR.titleShadowA, -0.85, 0.75],
      [COLOR.titleShadowB, 0.85, -0.75],
      [COLOR.title, 0, 0],
    ];
    for (const line of lines) {
      for (const [color, dx, dy] of layers) {
        setFont(doc, 'Bungee', 'normal', size, color);
        p.text(line, left + dx, y + dy);
      }
      y += leading;
    }

    setFont(doc, 'Aileron', 'normal', 10);
    p.text(`${totalSpecies} espécies registradas`, left, 243);
    if (handle) p.text(handle, left, 268);
  }

  // ── Back cover ───────────────────────────────────────────────────────────
  function drawBackCover(doc, p, { phrase }) {
    const logo = 88.5;
    p.image(window.ZINE_ASSETS.logo, (p.w - logo) / 2, 66, logo, logo);

    const measure = (s) => width(doc, 'Aileron', 'normal', 10, s);
    const lines = wrap(doc, phrase.split(/\s+/).filter(Boolean), p.w - 44, measure);
    setFont(doc, 'Aileron', 'normal', 10);
    lines.forEach((line, i) => {
      p.text(line, (p.w - doc.getTextWidth(line)) / 2, 189 + i * 11.25);
    });
  }

  // ── Checklist pages ──────────────────────────────────────────────────────
  function drawChecklistItem(doc, p, n, sp, rowY) {
    const boxX = 13;
    const textX = 32;
    const maxW = p.w - textX - 10;
    const box = 10.5;

    doc.setDrawColor(...COLOR.text);
    doc.setLineWidth(0.8);
    p.roundedRect(boxX, rowY - box / 2, box, box, 2.5, 'S');

    const num = `${n}. `;
    const com = `${sp.comName} `;
    const sci = sp.sciName;
    const runsWidth = (size) =>
      width(doc, 'Aileron', 'normal', size, num) +
      width(doc, 'Aileron', 'bold', size, com) +
      width(doc, 'Aileron', 'italic', size, sci);

    const drawRuns = (runs, x, y, size) => {
      for (const [style, str] of runs) {
        setFont(doc, 'Aileron', style, size);
        p.text(str, x, y);
        x += doc.getTextWidth(str);
      }
    };

    // One line if it fits at ≥ 6pt, else scientific name on a second line.
    for (let size = 7; size >= 6; size -= 0.25) {
      if (runsWidth(size) <= maxW) {
        drawRuns([['normal', num], ['bold', com], ['italic', sci]], textX, rowY + size * 0.35, size);
        return;
      }
    }
    let size = 7;
    while (size > 5 && width(doc, 'Aileron', 'normal', size, num) +
      Math.max(width(doc, 'Aileron', 'bold', size, sp.comName),
        width(doc, 'Aileron', 'italic', size, sci)) > maxW) size -= 0.25;
    const indent = width(doc, 'Aileron', 'normal', size, num);
    drawRuns([['normal', num], ['bold', sp.comName]], textX, rowY - 1.2, size);
    drawRuns([['italic', sci]], textX + indent, rowY - 1.2 + size * 1.15, size);
  }

  function drawChecklistPage(doc, p, items, startNumber) {
    const top = 18;
    const bottom = 16;
    const pitch = (p.h - top - bottom) / ROWS_PER_PAGE;
    items.forEach((sp, i) => {
      drawChecklistItem(doc, p, startNumber + i, sp, top + pitch * (i + 0.5));
    });
  }

  // ── Photo poster (side 2) ────────────────────────────────────────────────
  // Photos are laid out panel by panel (same 4×2 panels as side 1) so the
  // fold lines fall in the gutters, never across a photo. Numbering still
  // runs row by row across the whole sheet.
  function photoGrid(n) {
    const outer = { left: 14, right: 14, top: 12, bottom: 20 }; // page edges (footer below)
    const gutter = 7; // each side of a fold line
    const gap = 5;
    const captionH = 10;
    // Usable box of panel (col, row).
    const box = (col, row) => {
      const x0 = col * PW + (col === 0 ? outer.left : gutter);
      const x1 = (col + 1) * PW - (col === 3 ? outer.right : gutter);
      const y0 = row * PH + (row === 0 ? outer.top : gutter);
      const y1 = (row + 1) * PH - (row === 1 ? outer.bottom : gutter);
      return { x0, y0, w: x1 - x0, h: y1 - y0 };
    };
    // Smallest usable box bounds the cell size for every panel.
    const minW = Math.min(box(0, 0).w, box(1, 0).w);
    const minH = Math.min(box(0, 0).h, box(0, 1).h);

    let best = null;
    for (let perRow = 1; perRow <= 8; perRow++) {
      for (let perCol = 1; perCol <= 8; perCol++) {
        if (8 * perRow * perCol < n) continue;
        const cellW = (minW - (perRow - 1) * gap) / perRow;
        const cellH = (minH - (perCol - 1) * gap) / perCol;
        let imgW = cellW;
        let imgH = Math.min(cellH - captionH, imgW); // never taller than square
        if (imgH <= 0) continue;
        imgW = Math.min(imgW, imgH * 1.5); // never wider than 3:2
        const area = imgW * imgH;
        // Prefer bigger photos; on ties, fewer empty slots.
        if (!best || area > best.area + 0.5 ||
          (Math.abs(area - best.area) <= 0.5 && perRow * perCol < best.perRow * best.perCol)) {
          best = { perRow, perCol, cellW, cellH, imgW, imgH, area };
        }
      }
    }
    const cols = 4 * best.perRow;
    const totalRows = Math.ceil(n / cols);
    // Top-left of photo number i (0-based), centered within its panel box.
    best.position = (i) => {
      const gc = i % cols;
      const gr = Math.floor(i / cols);
      const panelRow = Math.floor(gr / best.perCol);
      const b = box(Math.floor(gc / best.perRow), panelRow);
      const usedRows = Math.min(best.perCol, totalRows - panelRow * best.perCol);
      const blockW = best.perRow * best.cellW + (best.perRow - 1) * gap;
      const blockH = usedRows * best.cellH + (usedRows - 1) * gap;
      const c = gc % best.perRow;
      const r = gr % best.perCol;
      return {
        x: b.x0 + (b.w - blockW) / 2 + c * (best.cellW + gap) + (best.cellW - best.imgW) / 2,
        y: b.y0 + (b.h - blockH) / 2 + r * (best.cellH + gap),
      };
    };
    return best;
  }

  function drawPhotoCell(doc, g, n, sp, image) {
    const { x, y } = g.position(n - 1);
    const { imgW, imgH } = g;

    if (image) {
      doc.addImage(image, 'JPEG', x, y, imgW, imgH, `photo-${sp.code}`);
    } else {
      doc.setFillColor(...COLOR.placeholder);
      doc.rect(x, y, imgW, imgH, 'F');
      const size = Math.min(7, imgW / 8);
      setFont(doc, 'Aileron', 'bold', size, COLOR.muted);
      const lines = wrap(doc, sp.comName.split(/(?<=-)|\s+/), imgW - 8,
        (s) => doc.getTextWidth(s)).map((l) => l.replace(/- /g, '-'));
      lines.forEach((l, k) => doc.text(l, x + 4, y + 4 + size * (k + 1) * 1.15));
    }

    // Number badge, bottom-right corner.
    const badge = Math.max(10, Math.min(12.5, imgW * 0.18));
    doc.setFillColor(0, 0, 0);
    doc.rect(x + imgW - badge, y + imgH - badge, badge, badge, 'F');
    const numSize = n >= 100 ? 5.5 : n >= 10 ? 6.5 : 8;
    setFont(doc, 'Aileron', 'normal', numSize, [255, 255, 255]);
    const label = String(n);
    doc.text(label, x + imgW - badge / 2 - doc.getTextWidth(label) / 2,
      y + imgH - badge / 2 + numSize * 0.35);

    const capSize = imgW < 70 ? 6 : 7;
    setFont(doc, 'Aileron', 'bold', capSize);
    const credit = image && sp.photo?.author ? `@${sp.photo.author}` : 'sem foto';
    doc.text(truncate(doc, credit, imgW), x, y + imgH + capSize + 1.5);
  }

  function drawPhotoFooter(doc, data) {
    const parts = [];
    if (data.photos.some(Boolean)) {
      parts.push('Fotos: WikiAves (wikiaves.com.br), autoria indicada em cada foto.');
    }
    parts.push(`Espécies observadas mais recentemente segundo o eBird — ebird.org/hotspot/${data.locId}`);
    setFont(doc, 'Aileron', 'normal', 5.5, COLOR.muted);
    const text = parts.join('  ·  ');
    const tw = doc.getTextWidth(text);
    // Blank out the fold line behind the text.
    doc.setFillColor(255, 255, 255);
    doc.rect((W - tw) / 2 - 3, H - 16, tw + 6, 9, 'F');
    doc.text(text, (W - tw) / 2, H - 10);
  }

  // ── Entry point ──────────────────────────────────────────────────────────

  /**
   * data: { locId, totalSpecies, species: [{code, comName, sciName, photo}] }
   *   (species already ordered and capped to MAX_SPECIES)
   * opts: { title, phrase, handle, onProgress }
   * Returns a jsPDF document.
   */
  async function render(data, opts) {
    const { jsPDF } = window.jspdf;
    const species = data.species.slice(0, MAX_SPECIES);
    const onProgress = opts.onProgress || (() => {});

    const grid = photoGrid(Math.max(species.length, 1));
    const images = await loadImages(species, grid.imgW / grid.imgH, onProgress);

    onProgress('Montando o PDF…');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    registerFonts(doc);
    doc.setProperties({
      title: opts.title,
      author: 'Bicipassarinhar',
      subject: `Checklist de aves — eBird ${data.locId}`,
      creator: 'zine-bicipa',
    });

    // Side 1
    drawGuides(doc);
    drawBackCover(doc, panel(doc, 0, 1), opts);
    drawFrontCover(doc, panel(doc, 1, 1), {
      title: opts.title, totalSpecies: data.totalSpecies, handle: opts.handle,
    });
    CHECKLIST_SLOTS.forEach(([col, row, rotated], page) => {
      const start = page * ROWS_PER_PAGE;
      const items = species.slice(start, start + ROWS_PER_PAGE);
      if (items.length) drawChecklistPage(doc, panel(doc, col, row, rotated), items, start + 1);
    });

    // Side 2
    doc.addPage('a4', 'landscape');
    drawGuides(doc);
    species.forEach((sp, i) => drawPhotoCell(doc, grid, i + 1, sp, images[i]));
    const shown = species.map((sp, i) => (images[i] ? sp.photo : null));
    drawPhotoFooter(doc, { locId: data.locId, photos: shown });

    return doc;
  }

  async function loadImages(species, aspect, onProgress) {
    const images = new Array(species.length).fill(null);
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < species.length) {
        const i = next++;
        const photo = species[i].photo;
        if (photo) {
          try {
            images[i] = await Photos.croppedDataUrl(photo, aspect);
          } catch (e) {
            console.warn('não foi possível baixar a foto', species[i].sciName, e);
          }
        }
        onProgress(`Baixando fotos: ${++done}/${species.length}`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return images;
  }

  return { render, MAX_SPECIES };
})();
