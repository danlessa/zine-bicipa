// Photo cropping for the PDF. Photos themselves come from Wikiaves through
// the bookmarklet bridge (js/wikiaves.js), already downloaded as Blobs.

const Photos = (() => {
  /**
   * Returns the photo as a JPEG data URL center-cropped to the requested
   * aspect ratio (width / height), at most `maxPx` wide.
   */
  const cropped = new Map();
  async function croppedDataUrl(photo, aspect, maxPx = 400) {
    const key = `${photo.url}|${aspect.toFixed(3)}|${maxPx}`;
    if (!cropped.has(key)) {
      const p = crop(photo.blob, aspect, maxPx);
      cropped.set(key, p);
      p.catch(() => cropped.delete(key));
    }
    return cropped.get(key);
  }

  async function crop(blob, aspect, maxPx) {
    if (!blob) throw new Error('foto não baixada');
    const bmp = await createImageBitmap(blob);
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

  return { croppedDataUrl };
})();
