import type { DetectionOptions, DetectionResult, Rgba, SpriteBox, SpritePreview } from './types';

type Box = { x: number; y: number; width: number; height: number };

export function rgbaToCss(c: Rgba | null) {
  if (!c) return 'transparent';
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.max(0, Math.min(1, c.a / 255))})`;
}

export function colorDistance(a: Rgba, b: Rgba) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function quantize(v: number, step = 8) {
  return Math.round(v / step) * step;
}

function brightness(c: Rgba) {
  return (c.r + c.g + c.b) / 3;
}

function saturation(c: Rgba) {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max - min;
}

function pixelAt(imageData: ImageData, x: number, y: number): Rgba {
  const i = (y * imageData.width + x) * 4;
  const d = imageData.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

function similar(a: Rgba, b: Rgba, tol: number) {
  if (a.a < 10 && b.a < 10) return true;
  return colorDistance(a, b) <= tol;
}

function uniqueColors(colors: Rgba[], tol = 24) {
  const out: Rgba[] = [];
  for (const c of colors) {
    if (!out.some(o => similar(o, c, tol))) out.push(c);
  }
  return out;
}

/**
 * Fundo principal: usa bordas e cantos. Em spritesheets, o fundo principal quase sempre toca as bordas.
 */
export function detectDominantBackground(imageData: ImageData): Rgba {
  const { width, height, data } = imageData;
  const map = new Map<string, { count: number; raw: Rgba }>();
  const stepX = Math.max(1, Math.floor(width / 220));
  const stepY = Math.max(1, Math.floor(height / 220));

  const add = (x: number, y: number, weight = 1) => {
    const i = (y * width + x) * 4;
    const raw: Rgba = { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
    const key = raw.a < 10 ? '0,0,0,0' : `${quantize(raw.r)},${quantize(raw.g)},${quantize(raw.b)},255`;
    const old = map.get(key) || { count: 0, raw };
    old.count += weight;
    old.raw = raw;
    map.set(key, old);
  };

  for (let x = 0; x < width; x += stepX) {
    add(x, 0, 4);
    add(x, height - 1, 4);
  }
  for (let y = 0; y < height; y += stepY) {
    add(0, y, 4);
    add(width - 1, y, 4);
  }

  const cornerW = Math.max(2, Math.floor(width * 0.08));
  const cornerH = Math.max(2, Math.floor(height * 0.08));
  for (let y = 0; y < cornerH; y += stepY) {
    for (let x = 0; x < cornerW; x += stepX) {
      add(x, y, 6);
      add(width - 1 - x, y, 6);
      add(x, height - 1 - y, 6);
      add(width - 1 - x, height - 1 - y, 6);
    }
  }

  const winner = [...map.values()].sort((a, b) => b.count - a.count)[0];
  return winner?.raw || { r: 0, g: 0, b: 0, a: 0 };
}

function dominantImageColors(imageData: ImageData, limit = 12): Array<{ color: Rgba; count: number; ratio: number }> {
  const { width, height, data } = imageData;
  const map = new Map<string, { count: number; color: Rgba }>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const color: Rgba = a < 10
      ? { r: 0, g: 0, b: 0, a: 0 }
      : { r: quantize(data[i]), g: quantize(data[i + 1]), b: quantize(data[i + 2]), a: 255 };
    const key = `${color.r},${color.g},${color.b},${color.a}`;
    const old = map.get(key) || { count: 0, color };
    old.count++;
    map.set(key, old);
  }
  const total = width * height;
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(v => ({ color: v.color, count: v.count, ratio: v.count / total }));
}

/**
 * Paleta automática de fundos removíveis.
 * Diferença da v2: além do fundo principal, remove também cores chapadas dominantes como
 * o amarelo dos quadros/células. Não remove preto automaticamente, para não destruir outlines.
 */
function detectBackgroundPalette(imageData: ImageData, options: DetectionOptions): Rgba[] {
  const primary = options.background || detectDominantBackground(imageData);
  const colors: Rgba[] = [primary];
  const dominant = dominantImageColors(imageData, 18);

  for (const item of dominant) {
    const c = item.color;
    if (c.a < 10) {
      colors.push(c);
      continue;
    }

    const bright = brightness(c);
    const sat = saturation(c);
    const closeToPrimary = similar(c, primary, Math.max(28, options.tolerance));

    // Cores chapadas claras/coloridas de células de frame, como amarelo, verde, azul, branco.
    // Exclui tons escuros para preservar contorno preto dos sprites.
    if (!closeToPrimary && item.ratio >= 0.012 && bright >= 48 && sat >= 12) {
      colors.push(c);
    }

    // Branco/cinza de fundo quadriculado falso.
    const gray = Math.abs(c.r - c.g) < 8 && Math.abs(c.g - c.b) < 8;
    if (!closeToPrimary && item.ratio >= 0.012 && bright >= 120 && gray) {
      colors.push(c);
    }
  }

  return uniqueColors(colors, 30).slice(0, 8);
}

function detectCellBackgroundColors(imageData: ImageData, options: DetectionOptions): Rgba[] {
  const primary = options.background || detectDominantBackground(imageData);
  const dominant = dominantImageColors(imageData, 18);
  const colors: Rgba[] = [];

  for (const item of dominant) {
    const c = item.color;
    if (c.a < 10) continue;
    if (similar(c, primary, Math.max(28, options.tolerance))) continue;
    if (item.ratio < 0.012) continue;
    if (brightness(c) < 55) continue;
    if (saturation(c) < 10) continue;
    // Ex.: amarelo dos frames. Serve também para outras cores fortes de célula.
    colors.push(c);
  }
  return uniqueColors(colors, 26).slice(0, 5);
}

function isCheckerLike(px: Rgba) {
  if (px.a < 10) return true;
  const nearWhite = px.r > 215 && px.g > 215 && px.b > 215;
  const gray = Math.abs(px.r - px.g) < 9 && Math.abs(px.g - px.b) < 9 && px.r > 125 && px.r < 215;
  return nearWhite || gray;
}

function isInPalette(px: Rgba, palette: Rgba[], tolerance: number) {
  if (px.a < 10) return true;
  for (const bg of palette) {
    if (bg.a < 10 && px.a < 10) return true;
    if (bg.a >= 10 && colorDistance(px, bg) <= tolerance) return true;
  }
  return false;
}

export function buildForegroundMask(imageData: ImageData, options: DetectionOptions): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  const palette = detectBackgroundPalette(imageData, options);
  const tolerance = Math.max(4, options.tolerance);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * 4;
      const px: Rgba = { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
      let isBg = isInPalette(px, palette, tolerance);

      if (!isBg && tolerance >= 20 && isCheckerLike(px)) {
        let around = 0;
        const coords = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1], [x - 2, y], [x + 2, y], [x, y - 2], [x, y + 2]];
        for (const [nx, ny] of coords) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            around++;
            continue;
          }
          if (isCheckerLike(pixelAt(imageData, nx, ny))) around++;
        }
        if (around >= 5) isBg = true;
      }

      mask[idx] = isBg ? 0 : 1;
    }
  }

  if (options.ignoreThinLines) removeLongThinLines(mask, width, height);
  if (options.removeSmallNoise) removeIsolatedPixels(mask, width, height);
  return mask;
}

function removeIsolatedPixels(mask: Uint8Array, width: number, height: number) {
  const copy = new Uint8Array(mask);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (!copy[idx]) continue;
      let count = 0;
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          if (xx === 0 && yy === 0) continue;
          count += copy[(y + yy) * width + x + xx];
        }
      }
      if (count <= 1) mask[idx] = 0;
    }
  }
}

function removeLongThinLines(mask: Uint8Array, width: number, height: number) {
  for (let y = 0; y < height; y++) {
    let runStart = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && mask[y * width + x];
      if (on && runStart < 0) runStart = x;
      if ((!on || x === width) && runStart >= 0) {
        const len = x - runStart;
        if (len > width * 0.45) for (let xx = runStart; xx < x; xx++) mask[y * width + xx] = 0;
        runStart = -1;
      }
    }
  }

  for (let x = 0; x < width; x++) {
    let runStart = -1;
    for (let y = 0; y <= height; y++) {
      const on = y < height && mask[y * width + x];
      if (on && runStart < 0) runStart = y;
      if ((!on || y === height) && runStart >= 0) {
        const len = y - runStart;
        if (len > height * 0.55) for (let yy = runStart; yy < y; yy++) mask[yy * width + x] = 0;
        runStart = -1;
      }
    }
  }
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8Array(mask);
  const out = new Uint8Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let yy = -radius; yy <= radius; yy++) {
        for (let xx = -radius; xx <= radius; xx++) {
          if (Math.abs(xx) + Math.abs(yy) > radius + 1) continue;
          const nx = x + xx, ny = y + yy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

function connectedComponentsFromMask(originalMask: Uint8Array, componentMask: Uint8Array, width: number, height: number, options: DetectionOptions, method: string): SpriteBox[] {
  const visited = new Uint8Array(width * height);
  const boxes: SpriteBox[] = [];
  const queue = new Int32Array(width * height);
  let id = 1;

  for (let start = 0; start < width * height; start++) {
    if (!componentMask[start] || visited[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width, maxX = 0, minY = height, maxY = 0, area = 0;

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (originalMask[idx]) {
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const nbs = [idx + 1, idx - 1, idx + width, idx - width, idx + width + 1, idx + width - 1, idx - width + 1, idx - width - 1];
      for (const ni of nbs) {
        if (ni < 0 || ni >= width * height || visited[ni] || !componentMask[ni]) continue;
        const nx = ni % width;
        const ny = Math.floor(ni / width);
        if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) continue;
        visited[ni] = 1;
        queue[tail++] = ni;
      }
    }

    if (area === 0) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const thinLine = options.ignoreThinLines && ((bw > width * 0.35 && bh <= 4) || (bh > height * 0.35 && bw <= 4));
    if (area >= options.minArea && area <= options.maxArea && bw >= options.minSpriteWidth && bh >= options.minSpriteHeight && !thinLine) {
      const p = options.padding;
      const x = Math.max(0, minX - p);
      const y = Math.max(0, minY - p);
      const x2 = Math.min(width, maxX + 1 + p);
      const y2 = Math.min(height, maxY + 1 + p);
      boxes.push({ id: String(id++), name: `sprite_${String(id - 1).padStart(3, '0')}.png`, x, y, width: x2 - x, height: y2 - y, method });
    }
  }
  return boxes;
}

function projectRuns(values: Uint32Array | number[], minCount: number, maxGap: number, minLength: number) {
  const runs: Array<[number, number]> = [];
  let start = -1;
  let lastOn = -1;
  for (let i = 0; i < values.length; i++) {
    const on = values[i] >= minCount;
    if (on) {
      if (start < 0) start = i;
      lastOn = i;
    } else if (start >= 0 && i - lastOn > maxGap) {
      if (lastOn - start + 1 >= minLength) runs.push([start, lastOn]);
      start = -1;
      lastOn = -1;
    }
  }
  if (start >= 0 && lastOn - start + 1 >= minLength) runs.push([start, lastOn]);
  return runs;
}

export function detectByProjection(imageData: ImageData, options: DetectionOptions): SpriteBox[] {
  const { width, height } = imageData;
  const mask = buildForegroundMask(imageData, options);
  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) c += mask[y * width + x];
    rowCounts[y] = c;
  }
  const rowRuns = projectRuns(rowCounts, Math.max(1, Math.floor(width * 0.002)), options.gapThreshold, Math.max(2, options.minSpriteHeight));
  const boxes: SpriteBox[] = [];
  let id = 1;

  for (const [y1, y2] of rowRuns) {
    colCounts.fill(0);
    for (let x = 0; x < width; x++) {
      let c = 0;
      for (let y = y1; y <= y2; y++) c += mask[y * width + x];
      colCounts[x] = c;
    }
    const colRuns = projectRuns(colCounts, Math.max(1, Math.floor((y2 - y1 + 1) * 0.015)), options.gapThreshold, Math.max(2, options.minSpriteWidth));
    for (const [x1, x2] of colRuns) {
      const tight = tightBoxFromMask(mask, width, height, { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 }, options.padding);
      if (tight && tight.width * tight.height >= options.minArea) boxes.push({ ...tight, id: String(id++), name: `sprite_${String(id - 1).padStart(3, '0')}.png`, method: 'projeção automática' });
    }
  }
  const split = splitLargeEffectBoxes(boxes, width, height, options, mask);
  return normalizeBoxes(split, width, height, options);
}

export function detectByConnectedComponents(imageData: ImageData, options: DetectionOptions): SpriteBox[] {
  const { width, height } = imageData;
  const originalMask = buildForegroundMask(imageData, options);
  const componentMask = dilateMask(originalMask, width, height, Math.max(0, Math.min(12, options.mergeDistance)));
  const boxes = connectedComponentsFromMask(originalMask, componentMask, width, height, options, 'componentes conectados');
  const split = splitLargeEffectBoxes(boxes, width, height, options, originalMask);
  return normalizeBoxes(split, width, height, options);
}

function tightBoxFromMask(mask: Uint8Array, width: number, height: number, region: Box, padding: number): Box | null {
  let minX = width, maxX = -1, minY = height, maxY = -1;
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width - 1, Math.ceil(region.x + region.width - 1));
  const y1 = Math.min(height - 1, Math.ceil(region.y + region.height - 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const x2 = Math.min(width, maxX + 1 + padding);
  const y2 = Math.min(height, maxY + 1 + padding);
  return { x, y, width: x2 - x, height: y2 - y };
}

function countMask(mask: Uint8Array, width: number, region: Box) {
  let c = 0;
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.floor(region.x + region.width - 1);
  const y1 = Math.floor(region.y + region.height - 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) c += mask[y * width + x];
  return c;
}

function splitCellRegionByFrames(mask: Uint8Array, width: number, height: number, region: Box, options: DetectionOptions): Box[] {
  const W = region.width;
  const H = region.height;
  if (W < Math.max(8, options.minSpriteWidth * 2) || W / Math.max(1, H) < 1.18) return [region];

  const cols: number[] = [];
  for (let xx = 0; xx < W; xx++) {
    let c = 0;
    const x = region.x + xx;
    for (let y = region.y; y < region.y + H; y++) c += mask[y * width + x];
    cols.push(c);
  }
  const sorted = [...cols].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;

  const maxN = Math.min(24, Math.floor(W / Math.max(4, options.minSpriteWidth)));
  let bestN = 1;
  let bestScore = -999999;
  let bestBounds: number[] = [0, W];

  for (let n = 2; n <= maxN; n++) {
    const cellW = W / n;
    if (cellW < Math.max(4, options.minSpriteWidth)) continue;
    const ratio = cellW / Math.max(1, H);
    if (ratio < 0.28 || ratio > 2.4) continue;

    const bounds = [0];
    let boundaryScore = 0;
    let badBoundary = 0;
    const searchRadius = Math.max(2, Math.floor(cellW * 0.22));

    for (let k = 1; k < n; k++) {
      const expected = Math.round(k * cellW);
      let best = expected;
      let bestVal = 999999;
      for (let off = -searchRadius; off <= searchRadius; off++) {
        const b = expected + off;
        if (b <= 2 || b >= W - 2) continue;
        const val = (cols[b - 1] || 0) + (cols[b] || 0) + (cols[b + 1] || 0);
        if (val < bestVal) {
          bestVal = val;
          best = b;
        }
      }
      bounds.push(best);
      const norm = bestVal / Math.max(1, median * 3);
      boundaryScore += norm;
      if (norm > 1.15) badBoundary++;
    }
    bounds.push(W);
    bounds.sort((a, b) => a - b);

    let empty = 0;
    let tiny = 0;
    for (let s = 0; s < bounds.length - 1; s++) {
      const seg: Box = { x: region.x + bounds[s], y: region.y, width: Math.max(1, bounds[s + 1] - bounds[s]), height: H };
      const area = countMask(mask, width, seg);
      if (area < Math.max(4, options.minArea * 0.35)) empty++;
      if (seg.width < options.minSpriteWidth) tiny++;
    }

    const aspectPenalty = ratio < 0.45 ? (0.45 - ratio) * 2.2 : ratio > 1.35 ? (ratio - 1.35) * 0.9 : 0;
    const preferredSmall = Math.round(W / Math.max(6, H * 0.58));
    const preferredWide = Math.round(W / Math.max(8, H * 0.95));
    const preferredPenalty = Math.min(Math.abs(n - preferredSmall), Math.abs(n - preferredWide)) * 0.10;
    const splitNeedBonus = Math.max(0, W / Math.max(1, H) - 1.15) * 0.45;

    const score = splitNeedBonus - (boundaryScore / (n - 1)) * 1.35 - empty * 3.5 - tiny * 2 - badBoundary * 0.28 - aspectPenalty - preferredPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestN = n;
      bestBounds = bounds;
    }
  }

  // Se a confiança é baixa, mantém como um frame só.
  if (bestN <= 1 || bestScore < -1.15) return [region];

  const out: Box[] = [];
  for (let i = 0; i < bestBounds.length - 1; i++) {
    const a = bestBounds[i];
    const b = bestBounds[i + 1];
    if (b - a < Math.max(3, options.minSpriteWidth)) continue;
    out.push({ x: region.x + a, y: region.y, width: b - a, height: H });
  }
  return out.length > 1 ? out : [region];
}

function cellBackgroundMask(imageData: ImageData, options: DetectionOptions, colors: Rgba[]): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  if (colors.length === 0) return mask;
  const tol = Math.max(18, Math.min(64, options.tolerance + 8));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const px: Rgba = { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
      if (px.a >= 10 && colors.some(c => colorDistance(px, c) <= tol)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function connectedBoxes(mask: Uint8Array, width: number, height: number, minArea: number): Box[] {
  const visited = new Uint8Array(width * height);
  const q = new Int32Array(width * height);
  const boxes: Box[] = [];

  for (let start = 0; start < width * height; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0, tail = 0;
    q[tail++] = start;
    visited[start] = 1;
    let minX = width, maxX = 0, minY = height, maxY = 0, area = 0;
    while (head < tail) {
      const idx = q[head++];
      const x = idx % width;
      const y = Math.floor(idx / width);
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nbs = [idx + 1, idx - 1, idx + width, idx - width];
      for (const ni of nbs) {
        if (ni < 0 || ni >= width * height || visited[ni] || !mask[ni]) continue;
        const nx = ni % width;
        const ny = Math.floor(ni / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[ni] = 1;
        q[tail++] = ni;
      }
    }
    if (area >= minArea) boxes.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
  }
  return boxes;
}

/**
 * Novo modo v3: detecta áreas de célula/frame por cores chapadas (ex.: amarelo),
 * divide tiras contínuas em frames e depois tira um crop justo do personagem.
 */
function detectByCellBackgrounds(imageData: ImageData, options: DetectionOptions): SpriteBox[] {
  const { width, height } = imageData;
  const cellColors = detectCellBackgroundColors(imageData, options);
  if (cellColors.length === 0) return [];

  const fgMask = buildForegroundMask(imageData, options);
  const cellMask = cellBackgroundMask(imageData, options, cellColors);
  const cellBoxes = connectedBoxes(cellMask, width, height, Math.max(20, options.minArea));

  const boxes: SpriteBox[] = [];
  let id = 1;
  for (const cell of cellBoxes) {
    if (cell.width < options.minSpriteWidth || cell.height < options.minSpriteHeight) continue;
    if (cell.width * cell.height > width * height * 0.75) continue;

    const segments = splitCellRegionByFrames(fgMask, width, height, cell, options);
    for (const seg of segments) {
      const tight = tightBoxFromMask(fgMask, width, height, seg, options.padding);
      if (!tight) continue;
      if (tight.width < options.minSpriteWidth || tight.height < options.minSpriteHeight) continue;
      if (tight.width * tight.height < options.minArea) continue;
      boxes.push({ ...tight, id: String(id++), name: `sprite_${String(id - 1).padStart(3, '0')}.png`, method: 'sprite por sprite v3' });
    }
  }

  const split = splitLargeEffectBoxes(boxes, width, height, options, fgMask);
  return normalizeBoxes(split, width, height, options);
}

function boxArea(b: Box) {
  return b.width * b.height;
}

function intersectionArea(a: Box, b: Box) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function iou(a: Box, b: Box) {
  const inter = intersectionArea(a, b);
  const union = boxArea(a) + boxArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}


function medianNumber(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function likelyTextBox(b: Box, imageWidth: number, imageHeight: number, medianArea: number) {
  const area = boxArea(b);
  const aspect = b.width / Math.max(1, b.height);
  const smallHeight = b.height <= Math.max(10, imageHeight * 0.018);
  const smallArea = area <= Math.max(22, medianArea * 0.32);
  const textLine = aspect >= 2.2 && b.height <= Math.max(18, imageHeight * 0.032);
  const tinyPunctuation = b.width <= 4 && b.height <= 10;
  return textLine || tinyPunctuation || (smallHeight && smallArea && aspect >= 0.45 && aspect <= 8);
}

function likelyLargePortraitBox(b: Box, imageWidth: number, imageHeight: number, medianArea: number) {
  const area = boxArea(b);
  const aspect = b.width / Math.max(1, b.height);
  const nearTop = b.y < imageHeight * 0.22;
  const nearRight = b.x > imageWidth * 0.55;
  const portraitShape = aspect >= 0.55 && aspect <= 1.45;
  const muchBigger = area > Math.max(medianArea * 8, imageWidth * imageHeight * 0.025);
  return nearTop && nearRight && portraitShape && muchBigger;
}

function splitBoxByVerticalValleys(mask: Uint8Array, imageWidth: number, imageHeight: number, box: SpriteBox, options: DetectionOptions): SpriteBox[] {
  if (!options.splitLargeEffects) return [box];

  const area = boxArea(box);
  const aspect = box.width / Math.max(1, box.height);
  const veryWide = aspect >= 2.2 && box.width >= Math.max(36, options.minSpriteWidth * 3);
  const huge = area > imageWidth * imageHeight * 0.035;
  if (!veryWide && !huge) return [box];

  const cols: number[] = [];
  for (let xx = 0; xx < box.width; xx++) {
    let c = 0;
    const x = box.x + xx;
    for (let y = box.y; y < box.y + box.height; y++) c += mask[y * imageWidth + x];
    cols.push(c);
  }

  const maxCol = Math.max(...cols, 1);
  const valleyThreshold = Math.max(1, Math.floor(maxCol * 0.08));
  const cuts: number[] = [0];
  let start = -1;

  for (let i = 1; i < cols.length - 1; i++) {
    const low = cols[i] <= valleyThreshold;
    if (low && start < 0) start = i;
    if ((!low || i === cols.length - 2) && start >= 0) {
      const end = low ? i : i - 1;
      if (end - start + 1 >= Math.max(2, Math.floor(box.width * 0.025))) {
        const cut = Math.floor((start + end) / 2);
        if (cut - cuts[cuts.length - 1] >= Math.max(8, options.minSpriteWidth)) cuts.push(cut);
      }
      start = -1;
    }
  }
  cuts.push(box.width);

  if (cuts.length <= 2) return [box];

  const out: SpriteBox[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < Math.max(5, options.minSpriteWidth)) continue;
    const tight = tightBoxFromMask(mask, imageWidth, imageHeight, { x: box.x + a, y: box.y, width: b - a, height: box.height }, options.padding);
    if (!tight) continue;
    if (tight.width < options.minSpriteWidth || tight.height < options.minSpriteHeight) continue;
    if (tight.width * tight.height < options.minArea) continue;
    out.push({ ...box, ...tight, method: `${box.method || 'detecção'} + efeito separado` });
  }

  return out.length > 1 ? out : [box];
}

function splitLargeEffectBoxes(boxes: SpriteBox[], width: number, height: number, options: DetectionOptions, mask?: Uint8Array) {
  if (!options.splitLargeEffects || !mask) return boxes;
  const out: SpriteBox[] = [];
  for (const box of boxes) out.push(...splitBoxByVerticalValleys(mask, width, height, box, options));
  return out;
}

function filterNoiseTextAndPortraits(boxes: SpriteBox[], width: number, height: number, options: DetectionOptions) {
  if (!options.ignoreText && !options.ignoreLargePortraits) return boxes;
  const areas = boxes.map(boxArea).filter(a => a >= Math.max(1, options.minArea)).sort((a, b) => a - b);
  const medianArea = medianNumber(areas) || Math.max(1, options.minArea * 3);

  return boxes.filter((b) => {
    if (options.ignoreLargePortraits && likelyLargePortraitBox(b, width, height, medianArea)) return false;
    if (options.ignoreText && likelyTextBox(b, width, height, medianArea)) return false;
    return true;
  });
}


function normalizeBoxes(boxes: SpriteBox[], width: number, height: number, options: DetectionOptions) {
  const prefiltered = filterNoiseTextAndPortraits(boxes, width, height, options);
  const clean = prefiltered
    .filter(b => b.width > 0 && b.height > 0)
    .filter(b => b.width * b.height >= Math.max(1, options.minArea))
    .filter(b => b.width <= width && b.height <= height)
    .sort((a, b) => a.y === b.y ? a.x - b.x : a.y - b.y);

  const result: SpriteBox[] = [];
  for (const b of clean) {
    const duplicate = result.some(r => iou(r, b) > 0.82 || intersectionArea(r, b) / Math.min(boxArea(r), boxArea(b)) > 0.90);
    if (!duplicate) result.push(b);
  }

  return result.map((b, index) => ({
    ...b,
    id: String(index + 1),
    name: `sprite_${String(index + 1).padStart(3, '0')}.png`
  }));
}

function detectionScore(boxes: SpriteBox[], imageData: ImageData) {
  const { width, height } = imageData;
  if (boxes.length === 0) return -999999;
  const imageArea = width * height;
  const areas = boxes.map(boxArea).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)] || 1;
  const hugeBoxes = boxes.filter(b => boxArea(b) > imageArea * 0.22).length;
  const tinyBoxes = boxes.filter(b => boxArea(b) < Math.max(16, median * 0.06)).length;
  return boxes.length * 120 - hugeBoxes * 700 - tinyBoxes * 18;
}

export function detectSpritesAuto(imageData: ImageData, options: DetectionOptions): DetectionResult {
  const cell = detectByCellBackgrounds(imageData, options);
  const cc = detectByConnectedComponents(imageData, options);
  const projection = detectByProjection(imageData, options);

  // A v3 prioriza o modo por células quando ele encontra muitos frames, porque é o que separa sprite por sprite.
  const candidates: DetectionResult[] = [
    { boxes: cell, method: 'sprite por sprite v3' },
    { boxes: cc, method: 'componentes conectados' },
    { boxes: projection, method: 'projeção automática' }
  ];

  candidates.sort((a, b) => detectionScore(b.boxes, imageData) - detectionScore(a.boxes, imageData));
  if (cell.length >= Math.max(4, cc.length * 0.65) && cell.length >= projection.length * 0.55) {
    return { boxes: cell, method: 'sprite por sprite v3' };
  }
  return candidates[0];
}

export function cropSprite(sourceCanvas: HTMLCanvasElement, box: SpriteBox, options: DetectionOptions): HTMLCanvasElement {
  const scale = options.exportScale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(sourceCanvas, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  removeBackgroundFromImageData(imageData, options);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function detectExportBackgroundPalette(imageData: ImageData, options: DetectionOptions): Rgba[] {
  const primary = options.background || detectDominantBackground(imageData);
  const samples: Rgba[] = [primary];
  const { width, height } = imageData;
  const points: Array<[number, number]> = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)],
    [width - 1, Math.floor(height / 2)]
  ];
  for (const [x, y] of points) {
    samples.push(pixelAt(imageData, x, y));
  }
  return uniqueColors(samples, Math.max(18, Math.min(38, options.tolerance))).slice(0, 6);
}

function exportBgMatch(px: Rgba, palette: Rgba[], tolerance: number) {
  if (px.a < 10) return true;
  if (isInPalette(px, palette, tolerance)) return true;
  if (isCheckerLike(px)) return true;
  return false;
}

export function removeBackgroundFromImageData(imageData: ImageData, options: DetectionOptions) {
  const { width, height, data } = imageData;
  const palette = detectExportBackgroundPalette(imageData, options);
  const tolerance = Math.max(10, Math.min(48, options.tolerance));
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    const i = idx * 4;
    const px: Rgba = { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
    if (!exportBgMatch(px, palette, tolerance)) return;
    visited[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < width; x++) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  while (head < tail) {
    const idx = queue[head++];
    const i = idx * 4;
    data[i + 3] = 0;
    const x = idx % width;
    const y = Math.floor(idx / width);
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }
}

export async function makePreviewSprites(sourceCanvas: HTMLCanvasElement, boxes: SpriteBox[], options: DetectionOptions): Promise<SpritePreview[]> {
  return boxes.map((box) => {
    const canvas = cropSprite(sourceCanvas, box, { ...options, exportScale: 1 });
    return { ...box, dataUrl: canvas.toDataURL('image/png') };
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve) => canvas.toBlob(blob => resolve(blob!), 'image/png'));
}
