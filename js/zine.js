// Draws the zine with jsPDF, following the look of examples/zine.pdf.
//
// The zine is a 16-page A7 booklet. Pages are drawn one by one through a
// panel context (local A7 coordinates), then imposed onto the two sides of
// a landscape A4 sheet (4×2 panels, top row upside down):
//
//   side 1 (outside)                 side 2 (inside)
//   ┌────┬────┬────┬────┐            ┌────┬────┬────┬────┐
//   │  5 │ 12 │  9 │  8 │ ← 180°     │  7 │ 10 │ 11 │  6 │ ← 180°
//   ├────┼────┼────┼────┤            ├────┼────┼────┼────┤
//   │  4 │ 13 │ 16 │  1 │            │  2 │ 15 │ 14 │  3 │
//   └────┴────┴────┴────┘            └────┴────┴────┴────┘
//
// Print duplex flipping on the short edge, lay the sheet inside-up, then
// fold: right half over left, top half down, left half over right (that
// last fold is the spine). Trim the top and right folded edges to free the
// pages. The imposition was derived by simulating exactly these folds.
//
// Page plan: 1 front cover · 2–13 six spreads, photos on the left page and
// their checklist on the right (14 species each) · 14–15 notes · 16 back.
// The same page drawers also produce a plain 16-page A7 PDF for reading.

const Zine = (() => {
  const W = 841.89; // A4 landscape, in pt
  const H = 595.28;
  const PW = W / 4; // A7 portrait
  const PH = H / 2;

  const PAGES = 16;
  const ROWS_PER_PAGE = 14;
  const CHECKLIST_PAGES = 6;
  const MAX_SPECIES = ROWS_PER_PAGE * CHECKLIST_PAGES; // 84

  const COLOR = {
    text: [0, 0, 0],
    muted: [110, 110, 110],
    guide: [217, 217, 217],
    rule: [200, 200, 200],
    title: [120, 67, 230], // #7843e6
    titleShadowA: [255, 0, 255],
    titleShadowB: [0, 255, 255],
    placeholder: [236, 236, 236],
  };

  // Page numbers per sheet side, left to right; the top row is upside down.
  const SHEET = [
    { top: [5, 12, 9, 8], bottom: [4, 13, 16, 1] }, // outside (cover)
    { top: [7, 10, 11, 6], bottom: [2, 15, 14, 3] }, // inside
  ];
  // page → {side, col, row, rotated}
  const IMPOSITION = {};
  SHEET.forEach(({ top, bottom }, side) => {
    top.forEach((n, col) => { IMPOSITION[n] = { side, col, row: 0, rotated: true }; });
    bottom.forEach((n, col) => { IMPOSITION[n] = { side, col, row: 1, rotated: false }; });
  });

  // What goes on page n.
  function pageContent(n) {
    if (n === 1) return { kind: 'front' };
    if (n === PAGES) return { kind: 'back' };
    if (n === 14 || n === 15) return { kind: 'notes', first: n === 14 };
    if (n % 2 === 0) return { kind: 'photos', group: (n - 2) / 2 };
    return { kind: 'checklist', group: (n - 3) / 2 };
  }

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

  // Drawing context for one A7 page placed at (x0, y0). Coordinates are
  // local to the page (top-left origin, upright); rotated panels are mapped
  // through 180°. Images come as {up, r180} pairs of pre-rotated pixels.
  function panel(doc, x0, y0, rotated = false) {
    const map = (x, y) => (rotated ? [x0 + PW - x, y0 + PH - y] : [x0 + x, y0 + y]);
    const corner = (x, y, w, h) => (rotated ? map(x + w, y + h) : map(x, y));
    return {
      w: PW,
      h: PH,
      rotated,
      text(str, x, y) {
        const [px, py] = map(x, y);
        doc.text(str, px, py, rotated ? { angle: 180 } : undefined);
      },
      rect(x, y, w, h, style) {
        const [px, py] = corner(x, y, w, h);
        doc.rect(px, py, w, h, style);
      },
      roundedRect(x, y, w, h, r, style) {
        const [px, py] = corner(x, y, w, h);
        doc.roundedRect(px, py, w, h, r, r, style);
      },
      line(x1, y1, x2, y2) {
        doc.line(...map(x1, y1), ...map(x2, y2));
      },
      image(img, x, y, w, h, alias) {
        const [px, py] = corner(x, y, w, h);
        const data = rotated ? img.r180 : img.up;
        doc.addImage(data, 'JPEG', px, py, w, h, alias && `${alias}${rotated ? '-r' : ''}`);
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
  function drawBackCover(doc, p, { phrase, credits, images }) {
    const logo = 88.5;
    p.image(images.logo, (p.w - logo) / 2, 66, logo, logo, 'logo');

    const measure = (s) => width(doc, 'Aileron', 'normal', 10, s);
    const lines = wrap(doc, phrase.split(/\s+/).filter(Boolean), p.w - 44, measure);
    setFont(doc, 'Aileron', 'normal', 10);
    lines.forEach((line, i) => {
      p.text(line, (p.w - doc.getTextWidth(line)) / 2, 189 + i * 11.25);
    });

    // Photo and data credits, bottom-aligned.
    const size = 5.5;
    const leading = size * 1.3;
    const creditLines = credits.flatMap((c) =>
      wrap(doc, c.split(/\s+/), p.w - 30, (s) => width(doc, 'Aileron', 'normal', size, s)));
    setFont(doc, 'Aileron', 'normal', size, COLOR.muted);
    creditLines.forEach((line, i) => {
      const y = p.h - 14 - (creditLines.length - 1 - i) * leading;
      p.text(line, (p.w - doc.getTextWidth(line)) / 2, y);
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

  // ── Photo pages ──────────────────────────────────────────────────────────
  // One page per checklist page, facing it: same 14 species, same numbers.
  function photoGrid(n) {
    const box = { x0: 12, y0: 16, w: PW - 24, h: PH - 32 };
    const gap = 6;
    const captionH = 10;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cellW = (box.w - (cols - 1) * gap) / cols;
      const cellH = (box.h - (rows - 1) * gap) / rows;
      let imgW = cellW;
      let imgH = Math.min(cellH - captionH, imgW); // never taller than square
      if (imgH <= 0) continue;
      imgW = Math.min(imgW, imgH * 1.5); // never wider than 3:2
      if (!best || imgW * imgH > best.imgW * best.imgH) {
        best = { cols, rows, cellW, cellH, imgW, imgH };
      }
    }
    const blockW = best.cols * best.cellW + (best.cols - 1) * gap;
    const blockH = best.rows * best.cellH + (best.rows - 1) * gap;
    best.position = (i) => ({
      x: box.x0 + (box.w - blockW) / 2 + (i % best.cols) * (best.cellW + gap) + (best.cellW - best.imgW) / 2,
      y: box.y0 + (box.h - blockH) / 2 + Math.floor(i / best.cols) * (best.cellH + gap),
    });
    return best;
  }

  function drawPhotoCell(doc, p, g, i, n, sp, image) {
    const { x, y } = g.position(i);
    const { imgW, imgH } = g;

    if (image) {
      p.image(image, x, y, imgW, imgH, `photo-${sp.code}`);
    } else {
      doc.setFillColor(...COLOR.placeholder);
      p.rect(x, y, imgW, imgH, 'F');
      const size = Math.min(7, imgW / 8);
      setFont(doc, 'Aileron', 'bold', size, COLOR.muted);
      const lines = wrap(doc, sp.comName.split(/(?<=-)|\s+/), imgW - 8,
        (s) => doc.getTextWidth(s)).map((l) => l.replace(/- /g, '-'));
      lines.forEach((l, k) => p.text(l, x + 4, y + 4 + size * (k + 1) * 1.15));
    }

    // Number badge, bottom-right corner.
    const badge = Math.max(10, Math.min(12.5, imgW * 0.18));
    doc.setFillColor(0, 0, 0);
    p.rect(x + imgW - badge, y + imgH - badge, badge, badge, 'F');
    const numSize = n >= 100 ? 5.5 : n >= 10 ? 6.5 : 8;
    setFont(doc, 'Aileron', 'normal', numSize, [255, 255, 255]);
    const label = String(n);
    p.text(label, x + imgW - badge / 2 - doc.getTextWidth(label) / 2,
      y + imgH - badge / 2 + numSize * 0.35);

    const capSize = imgW < 70 ? 6 : 7;
    setFont(doc, 'Aileron', 'bold', capSize);
    const credit = image && sp.photo?.author ? `@${sp.photo.author}` : 'sem foto';
    p.text(truncate(doc, credit, imgW), x, y + imgH + capSize + 1.5);
  }

  function drawPhotoPage(doc, p, ctx, group) {
    const start = group * ROWS_PER_PAGE;
    ctx.species.slice(start, start + ROWS_PER_PAGE).forEach((sp, i) => {
      drawPhotoCell(doc, p, ctx.grid, i, start + i + 1, sp, ctx.images.photos[start + i]);
    });
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  function drawNotes(doc, p, first) {
    const left = 17;
    const right = p.w - 17;
    let y = 30;
    doc.setDrawColor(...COLOR.rule);
    doc.setLineWidth(0.5);
    if (first) {
      setFont(doc, 'Bungee', 'normal', 14, COLOR.title);
      p.text('ANOTAÇÕES', left, y + 6);
      y += 30;
      setFont(doc, 'Aileron', 'normal', 8);
      for (const label of ['Data', 'Horário', 'Clima', 'Companhia']) {
        p.text(`${label}:`, left, y);
        p.line(left + doc.getTextWidth(`${label}:`) + 4, y + 1, right, y + 1);
        y += 20;
      }
      y += 4;
    }
    for (; y <= p.h - 20; y += 18) p.line(left, y, right, y);
  }

  function credits(locId, hasPhotos) {
    const parts = [];
    if (hasPhotos) parts.push('Fotos: WikiAves (wikiaves.com.br), autoria indicada em cada foto.');
    parts.push(`Espécies observadas mais recentemente segundo o eBird — ebird.org/hotspot/${locId}`);
    return parts;
  }

  // ── Entry point ──────────────────────────────────────────────────────────

  function drawPage(doc, p, n, ctx) {
    const content = pageContent(n);
    const start = (content.group ?? 0) * ROWS_PER_PAGE;
    switch (content.kind) {
      case 'front':
        drawFrontCover(doc, p, {
          title: ctx.opts.title, totalSpecies: ctx.data.totalSpecies, handle: ctx.opts.handle,
        });
        break;
      case 'back':
        drawBackCover(doc, p, {
          phrase: ctx.opts.phrase,
          credits: credits(ctx.data.locId, ctx.images.photos.some(Boolean)),
          images: ctx.images,
        });
        break;
      case 'notes':
        drawNotes(doc, p, content.first);
        break;
      case 'photos':
        drawPhotoPage(doc, p, ctx, content.group);
        break;
      case 'checklist': {
        const items = ctx.species.slice(start, start + ROWS_PER_PAGE);
        if (items.length) drawChecklistPage(doc, p, items, start + 1);
        break;
      }
      default:
        break;
    }
  }

  function newDoc(format, orientation, opts, data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation, unit: 'pt', format, compress: true });
    registerFonts(doc);
    doc.setProperties({
      title: opts.title,
      author: 'Bicipassarinhar',
      subject: `Checklist de aves — eBird ${data.locId}`,
      creator: 'zine-bicipa',
    });
    return doc;
  }

  /**
   * data: { locId, totalSpecies, species: [{code, comName, sciName, photo}] }
   *   (species already ordered and capped to MAX_SPECIES)
   * opts: { title, phrase, handle, onProgress }
   * Returns { sheet, pages }: the imposed two-sided A4 PDF to print, and the
   * same zine as 16 A7 pages in reading order.
   */
  async function render(data, opts) {
    const species = data.species.slice(0, MAX_SPECIES);
    const onProgress = opts.onProgress || (() => {});
    const grid = photoGrid(ROWS_PER_PAGE);
    const images = await loadImages(species, grid.imgW / grid.imgH, onProgress);
    const ctx = { data, opts, species, grid, images };

    onProgress('Montando o PDF…');
    const sheet = newDoc('a4', 'landscape', opts, data);
    sheet.addPage('a4', 'landscape');
    for (const side of [1, 2]) {
      sheet.setPage(side);
      drawGuides(sheet);
    }
    for (let n = 1; n <= PAGES; n++) {
      const { side, col, row, rotated } = IMPOSITION[n];
      sheet.setPage(side + 1);
      drawPage(sheet, panel(sheet, col * PW, row * PH, rotated), n, ctx);
    }

    const pages = newDoc([PW, PH], 'portrait', opts, data);
    for (let n = 1; n <= PAGES; n++) {
      if (n > 1) pages.addPage([PW, PH], 'portrait');
      drawPage(pages, panel(pages, 0, 0, false), n, ctx);
    }

    return { sheet, pages };
  }

  // Cropped photos (and the logo) as {up, r180} pairs.
  async function loadImages(species, aspect, onProgress) {
    const photos = new Array(species.length).fill(null);
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < species.length) {
        const i = next++;
        const photo = species[i].photo;
        if (photo) {
          try {
            const up = await Photos.croppedDataUrl(photo, aspect);
            photos[i] = { up, r180: await Photos.rotated180(up) };
          } catch (e) {
            console.warn('não foi possível preparar a foto', species[i].sciName, e);
          }
        }
        onProgress(`Preparando fotos: ${++done}/${species.length}`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const logoUp = window.ZINE_ASSETS.logo;
    return { photos, logo: { up: logoUp, r180: await Photos.rotated180(logoUp) } };
  }

  return { render, MAX_SPECIES };
})();
