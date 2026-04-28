import { useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Download, ImageUp, ScanSearch, Trash2, Eraser, Sparkles, Plus, Grid2X2, Save, X, Wand2, Boxes, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import type { DetectionOptions, Rgba, SpriteBox, SpritePreview } from './types';
import {
  canvasToBlob,
  cropSprite,
  detectByConnectedComponents,
  detectByProjection,
  detectDominantBackground,
  detectSpritesAuto,
  makePreviewSprites,
  rgbaToCss
} from './imageProcessing';

type DragState = {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  original: SpriteBox;
} | null;

const defaultOptions: DetectionOptions = {
  tolerance: 42,
  padding: 2,
  minArea: 16,
  maxArea: 999999999,
  mergeDistance: 4,
  gapThreshold: 3,
  minSpriteWidth: 4,
  minSpriteHeight: 4,
  ignoreThinLines: true,
  removeSmallNoise: true,
  preserveShadow: true,
  pixelArt: true,
  ignoreText: true,
  ignoreLargePortraits: true,
  splitLargeEffects: true,
  exportScale: 1,
  background: null
};


type PresetKey = 'ragnarok' | 'nintendo' | 'rpgmaker' | 'generic';
type ModalKey = null | 'help' | 'report' | 'credits';
type Lang = 'pt' | 'en';

const GITHUB_URL = 'https://github.com/veryhardgg-del/sprite-cutter-pro';
const REPORT_URL = 'https://github.com/veryhardgg-del/sprite-cutter-pro/issues/new';

const PRESETS: Record<PresetKey, { labelPt: string; labelEn: string; notePt: string; noteEn: string; values: Partial<DetectionOptions> }> = {
  ragnarok: {
    labelPt: 'Ragnarok Online',
    labelEn: 'Ragnarok Online',
    notePt: 'Bom para sprites com sombra, armas e efeitos próximos.',
    noteEn: 'Good for sprites with shadows, weapons and nearby effects.',
    values: { tolerance: 44, padding: 2, minArea: 14, mergeDistance: 5, gapThreshold: 3, minSpriteWidth: 4, minSpriteHeight: 8, ignoreThinLines: true, removeSmallNoise: true, pixelArt: true, ignoreText: true, ignoreLargePortraits: true, splitLargeEffects: true }
  },
  nintendo: {
    labelPt: 'Nintendo DS/GBA',
    labelEn: 'Nintendo DS/GBA',
    notePt: 'Focado em fundos coloridos fortes, como verde, azul e amarelo.',
    noteEn: 'Focused on strong flat backgrounds like green, blue and yellow.',
    values: { tolerance: 52, padding: 1, minArea: 10, mergeDistance: 3, gapThreshold: 2, minSpriteWidth: 3, minSpriteHeight: 5, ignoreThinLines: true, removeSmallNoise: true, pixelArt: true, ignoreText: true, ignoreLargePortraits: true, splitLargeEffects: true }
  },
  rpgmaker: {
    labelPt: 'RPG Maker',
    labelEn: 'RPG Maker',
    notePt: 'Melhor para spritesheets em grade e frames padronizados.',
    noteEn: 'Best for grid-based sheets and standardized frames.',
    values: { tolerance: 36, padding: 0, minArea: 18, mergeDistance: 1, gapThreshold: 1, minSpriteWidth: 8, minSpriteHeight: 8, ignoreThinLines: true, removeSmallNoise: true, pixelArt: true, ignoreText: true, ignoreLargePortraits: true, splitLargeEffects: true }
  },
  generic: {
    labelPt: 'Pixel Art genérico',
    labelEn: 'Generic Pixel Art',
    notePt: 'Configuração equilibrada para pixel art e jogos 2D variados.',
    noteEn: 'Balanced setup for pixel art and many 2D games.',
    values: { tolerance: 42, padding: 2, minArea: 16, mergeDistance: 4, gapThreshold: 3, minSpriteWidth: 4, minSpriteHeight: 4, ignoreThinLines: true, removeSmallNoise: true, pixelArt: true, ignoreText: true, ignoreLargePortraits: true, splitLargeEffects: true }
  }
};


function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function useObjectUrl(file: File | null) {
  return useMemo(() => file ? URL.createObjectURL(file) : '', [file]);
}

export default function App() {
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<DetectionOptions>(defaultOptions);
  const [boxes, setBoxes] = useState<SpriteBox[]>([]);
  const [sprites, setSprites] = useState<SpritePreview[]>([]);
  const [status, setStatus] = useState('Envie uma spritesheet para começar.');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [selectBgMode, setSelectBgMode] = useState(false);
  const [drag, setDrag] = useState<DragState>(null);
  const [previewBg, setPreviewBg] = useState<'transparent' | 'black' | 'white'>('transparent');
  const [lastMethod, setLastMethod] = useState('-');
  const [modal, setModal] = useState<ModalKey>(null);
  const [lang, setLang] = useState<Lang>('pt');
  const [activePreset, setActivePreset] = useState<PresetKey>('generic');
  const [zoom, setZoom] = useState(1);

  const imageUrl = useObjectUrl(file);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const uploaded = e.target.files?.[0];
    if (!uploaded) return;
    e.target.value = '';
    setZoom(1);
    setSelectBgMode(false);
    setDrag(null);
    setFile(uploaded);
    setBoxes([]);
    setSprites([]);
    setLastMethod('-');
    setStatus('Carregando imagem...');

    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      sourceCanvasRef.current = canvas;
      setImageSize({ width: canvas.width, height: canvas.height });

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const bg = detectDominantBackground(imageData);
      const nextOptions = { ...options, background: bg, maxArea: canvas.width * canvas.height };
      setOptions(nextOptions);

      setStatus(`Imagem carregada: ${canvas.width}x${canvas.height}px. Rodando detecção automática...`);

      // detecção automática imediatamente após upload
      await new Promise(requestAnimationFrame);
      await runDetectionWithOptions(nextOptions, 'auto');
    };
    img.src = URL.createObjectURL(uploaded);
  }

  function getImageData() {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  async function runDetectionWithOptions(opts = options, mode: 'auto' | 'cc' | 'projection' = 'auto') {
    const imageData = getImageData();
    const canvas = sourceCanvasRef.current;
    if (!imageData || !canvas) return;

    setStatus(mode === 'auto' ? 'Detectando sprites automaticamente...' : 'Rodando método de detecção selecionado...');
    await new Promise(requestAnimationFrame);

    let found: SpriteBox[] = [];
    let method = '';

    if (mode === 'cc') {
      found = detectByConnectedComponents(imageData, opts);
      method = 'componentes conectados';
    } else if (mode === 'projection') {
      found = detectByProjection(imageData, opts);
      method = 'projeção por linhas/colunas';
    } else {
      const result = detectSpritesAuto(imageData, opts);
      found = result.boxes;
      method = result.method;
    }

    setBoxes(found);
    setLastMethod(method);
    redrawOverlay(found);
    const previews = await makePreviewSprites(canvas, found, opts);
    setSprites(previews);
    setStatus(`${found.length} sprite(s) detectada(s). Método usado: ${method}.`);
  }

  async function runDetection() {
    await runDetectionWithOptions(options, 'auto');
  }

  async function runProjectionOnly() {
    await runDetectionWithOptions(options, 'projection');
  }

  async function runConnectedOnly() {
    await runDetectionWithOptions(options, 'cc');
  }

  async function refreshPreviews(nextBoxes = boxes, opts = options) {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    const previews = await makePreviewSprites(canvas, nextBoxes, opts);
    setSprites(previews);
    redrawOverlay(nextBoxes);
  }

  function clearProject() {
    setFile(null);
    setBoxes([]);
    setSprites([]);
    sourceCanvasRef.current = null;
    setImageSize({ width: 0, height: 0 });
    setOptions(defaultOptions);
    setSelectBgMode(false);
    setDrag(null);
    setPreviewBg('transparent');
    setStatus('Projeto limpo. Envie uma nova spritesheet.');
    setLastMethod('-');
    setZoom(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function redrawOverlay(nextBoxes = boxes) {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const w = sourceCanvasRef.current?.width || imageSize.width;
    const h = sourceCanvasRef.current?.height || imageSize.height;
    if (!w || !h) return;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1, Math.round(Math.min(w, h) / 800));
    ctx.font = `${Math.max(10, Math.round(Math.min(w, h) / 80))}px monospace`;

    nextBoxes.forEach((box, index) => {
      ctx.strokeStyle = box.selected ? '#f59e0b' : '#22c55e';
      ctx.fillStyle = box.selected ? 'rgba(245,158,11,.18)' : 'rgba(34,197,94,.12)';
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width, box.height);
      ctx.fillRect(box.x, box.y, box.width, box.height);
      const labelW = 58;
      const labelH = 16;
      ctx.fillStyle = box.selected ? '#f59e0b' : '#22c55e';
      ctx.fillRect(box.x, Math.max(0, box.y - labelH), labelW, labelH);
      ctx.fillStyle = '#07111f';
      ctx.fillText(String(index + 1).padStart(3, '0'), box.x + 5, Math.max(12, box.y - 4));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(box.x + box.width - 9, box.y + box.height - 9, 9, 9);
    });
  }

  function imagePointFromMouse(e: React.MouseEvent) {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * (canvas.width / rect.width)),
      y: Math.round((e.clientY - rect.top) * (canvas.height / rect.height))
    };
  }

  function getPixelColor(x: number, y: number): Rgba | null {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const d = ctx.getImageData(clamp(x, 0, canvas.width - 1), clamp(y, 0, canvas.height - 1), 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }

  async function handlePointerDown(e: React.MouseEvent) {
    if (!sourceCanvasRef.current) return;
    const point = imagePointFromMouse(e);

    if (selectBgMode) {
      const color = getPixelColor(point.x, point.y);
      if (color) {
        const nextOptions = { ...options, background: color };
        setOptions(nextOptions);
        setStatus(`Fundo selecionado manualmente: RGB(${color.r}, ${color.g}, ${color.b}). Detectando de novo...`);
        setSelectBgMode(false);
        await runDetectionWithOptions(nextOptions, 'auto');
      }
      return;
    }

    const found = [...boxes].reverse().find(b => (
      point.x >= b.x && point.x <= b.x + b.width &&
      point.y >= b.y && point.y <= b.y + b.height
    ));

    if (!found) {
      const next = boxes.map(b => ({ ...b, selected: false }));
      setBoxes(next);
      redrawOverlay(next);
      return;
    }

    const resize = point.x > found.x + found.width - 14 && point.y > found.y + found.height - 14;
    const next = boxes.map(b => ({ ...b, selected: b.id === found.id }));
    setBoxes(next);
    redrawOverlay(next);
    setDrag({
      id: found.id,
      mode: resize ? 'resize' : 'move',
      startX: point.x,
      startY: point.y,
      original: { ...found }
    });
  }

  function handlePointerMove(e: React.MouseEvent) {
    if (!drag || !sourceCanvasRef.current) return;
    const point = imagePointFromMouse(e);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    const W = sourceCanvasRef.current.width;
    const H = sourceCanvasRef.current.height;

    const next = boxes.map(b => {
      if (b.id !== drag.id) return b;
      if (drag.mode === 'move') {
        return {
          ...b,
          x: clamp(drag.original.x + dx, 0, W - b.width),
          y: clamp(drag.original.y + dy, 0, H - b.height)
        };
      }
      return {
        ...b,
        width: clamp(drag.original.width + dx, 1, W - drag.original.x),
        height: clamp(drag.original.height + dy, 1, H - drag.original.y)
      };
    });
    setBoxes(next);
    redrawOverlay(next);
  }

  async function handlePointerUp() {
    if (drag) {
      setDrag(null);
      await refreshPreviews();
    }
  }

  async function addManualBox() {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    const id = String(Date.now());
    const box: SpriteBox = {
      id,
      name: `sprite_${String(boxes.length + 1).padStart(3, '0')}.png`,
      x: Math.round(canvas.width * 0.1),
      y: Math.round(canvas.height * 0.1),
      width: Math.max(16, Math.round(canvas.width * 0.12)),
      height: Math.max(16, Math.round(canvas.height * 0.12)),
      selected: true,
      method: 'manual'
    };
    const next = [...boxes.map(b => ({ ...b, selected: false })), box];
    setBoxes(next);
    await refreshPreviews(next);
  }

  async function deleteBox(id: string) {
    const next = boxes.filter(b => b.id !== id).map((b, i) => ({
      ...b,
      id: String(i + 1),
      name: b.name || `sprite_${String(i + 1).padStart(3, '0')}.png`
    }));
    setBoxes(next);
    await refreshPreviews(next);
  }

  async function updateBoxName(id: string, name: string) {
    const safe = name.endsWith('.png') ? name : `${name}.png`;
    const next = boxes.map(b => b.id === id ? { ...b, name: safe } : b);
    setBoxes(next);
    await refreshPreviews(next);
  }

  async function updateOption<K extends keyof DetectionOptions>(key: K, value: DetectionOptions[K], redetect = false) {
    const next = { ...options, [key]: value };
    setOptions(next);
    if (redetect && file) await runDetectionWithOptions(next, 'auto');
  }

  async function exportZip() {
    const canvas = sourceCanvasRef.current;
    if (!canvas || boxes.length === 0) return;
    setStatus('Gerando ZIP com PNG transparente...');
    const zip = new JSZip();
    const spritesFolder = zip.folder('sprites')!;
    const dataFolder = zip.folder('data')!;
    const previewFolder = zip.folder('preview')!;

    const metadata = [];
    for (const [index, box] of boxes.entries()) {
      const name = box.name || `sprite_${String(index + 1).padStart(3, '0')}.png`;
      const spriteCanvas = cropSprite(canvas, box, options);
      const blob = await canvasToBlob(spriteCanvas);
      spritesFolder.file(name, blob);
      metadata.push({
        name,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        exportScale: options.exportScale,
        method: box.method || lastMethod
      });
    }

    dataFolder.file('metadata.json', JSON.stringify(metadata, null, 2));

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = canvas.width;
    previewCanvas.height = canvas.height;
    const pctx = previewCanvas.getContext('2d')!;
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(canvas, 0, 0);
    boxes.forEach(b => {
      pctx.strokeStyle = '#22c55e';
      pctx.lineWidth = 2;
      pctx.strokeRect(b.x + 0.5, b.y + 0.5, b.width, b.height);
    });
    previewFolder.file('spritesheet_preview.png', await canvasToBlob(previewCanvas));

    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, 'sprite-cutter-pro-export.zip');
    setStatus('ZIP exportado com sucesso.');
  }

  async function detectByGrid() {
    const canvas = sourceCanvasRef.current;
    if (!canvas) return;
    const cols = Number(prompt('Quantas colunas na grade?', '4') || '4');
    const rows = Number(prompt('Quantas linhas na grade?', '4') || '4');
    if (!cols || !rows) return;
    const cellW = Math.floor(canvas.width / cols);
    const cellH = Math.floor(canvas.height / rows);
    const next: SpriteBox[] = [];
    let n = 1;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        next.push({
          id: String(n),
          name: `sprite_${String(n).padStart(3, '0')}.png`,
          x: x * cellW,
          y: y * cellH,
          width: x === cols - 1 ? canvas.width - x * cellW : cellW,
          height: y === rows - 1 ? canvas.height - y * cellH : cellH,
          method: 'grade manual'
        });
        n++;
      }
    }
    setBoxes(next);
    setLastMethod('grade manual');
    await refreshPreviews(next);
    setStatus(`${next.length} caixas criadas por grade manual.`);
  }


  async function applyPreset(key: PresetKey) {
    const preset = PRESETS[key];
    const nextOptions = {
      ...options,
      ...preset.values,
      background: options.background,
      maxArea: options.maxArea,
      exportScale: options.exportScale
    };
    setActivePreset(key);
    setOptions(nextOptions);
    setStatus(`${lang === 'pt' ? 'Preset aplicado' : 'Preset applied'}: ${lang === 'pt' ? preset.labelPt : preset.labelEn}`);
    if (file) await runDetectionWithOptions(nextOptions, 'auto');
  }


  function zoomIn() {
    setZoom(prev => Math.min(6, Number((prev + 0.25).toFixed(2))));
  }

  function zoomOut() {
    setZoom(prev => Math.max(0.25, Number((prev - 0.25).toFixed(2))));
  }

  function resetZoom() {
    setZoom(1);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Logo do Sprite Cutter Pro" />
          <div>
            <h1>Sprite Cutter Pro <small>v4.7</small></h1>
            <p>Detecção melhorada, zoom e recorte manual</p>
          </div>
        </div>

        <div className="actions">
          <label className="button primary">
            <ImageUp size={18} />
            Upload
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onClick={(e) => { e.currentTarget.value = ""; }} onChange={handleUpload} />
          </label>
          <button className="button" onClick={runDetection} disabled={!file}>
            <Wand2 size={18} /> Auto detectar
          </button>
          <button className={`button ${selectBgMode ? 'active' : ''}`} onClick={() => setSelectBgMode(v => !v)} disabled={!file}>
            <Eraser size={18} /> Selecionar fundo
          </button>
          <button className="button" onClick={exportZip} disabled={!file || boxes.length === 0}>
            <Download size={18} /> Exportar ZIP
          </button>
          <button className="button danger" onClick={clearProject}>
            <Trash2 size={18} /> Limpar
          </button>
        </div>
      </header>

      <nav className="subbar">
        <button className="sub-button" onClick={() => setModal('help')}>❔ {lang === 'pt' ? 'Como usar' : 'How to use'}</button>
        <button className="sub-button" onClick={() => setModal('report')}>🐞 {lang === 'pt' ? 'Reportar problema' : 'Report issue'}</button>
        <a className="sub-button" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        <button className="sub-button" onClick={() => setModal('credits')}>💜 {lang === 'pt' ? 'Créditos' : 'Credits'}</button>
        <span className="sub-button local-badge">🔒 {lang === 'pt' ? 'Processamento 100% local' : '100% local processing'}</span>
        <button className="sub-button" onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}>{lang === 'pt' ? 'EN' : 'PT-BR'}</button>
      </nav>

      <main className="workspace">
        <aside className="panel left">
          <h2>Configurações automáticas</h2>

          <div className="notice">
            <strong>🔒 {lang === 'pt' ? 'Processamento 100% local' : '100% local processing'}</strong>
            <span>{lang === 'pt' ? 'Suas imagens não são enviadas para servidor. Tudo roda no navegador.' : 'Your images are never uploaded. Everything runs inside the browser.'}</span>
          </div>

          <section className="preset-box">
            <h3>Presets</h3>
            <div className="preset-grid">
              {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
                <button key={key} className={`preset ${activePreset === key ? 'selected' : ''}`} onClick={() => applyPreset(key)}>
                  {lang === 'pt' ? PRESETS[key].labelPt : PRESETS[key].labelEn}
                </button>
              ))}
            </div>
            <p>{lang === 'pt' ? PRESETS[activePreset].notePt : PRESETS[activePreset].noteEn}</p>
          </section>

          <div className="notice note">
            <strong>{lang === 'pt' ? 'Dica importante' : 'Important tip'}</strong>
            <span>{lang === 'pt'
              ? 'Em spritesheets muito complexas, com efeitos grandes, textos ou muitos tamanhos diferentes, talvez seja necessário ajustar os presets ou corrigir alguns recortes manualmente.'
              : 'In very complex spritesheets with large effects, text, or many different sizes, you may need to adjust presets or manually fix some crops.'}</span>
          </div>

          <div className="bg-card">
            <span>Fundo detectado</span>
            <div className="color-row">
              <div className="color-swatch" style={{ background: rgbaToCss(options.background) }} />
              <code>{options.background ? `rgba(${options.background.r},${options.background.g},${options.background.b},${options.background.a})` : 'nenhum'}</code>
            </div>
          </div>

          <Control label="Tolerância do fundo" value={options.tolerance}>
            <input type="range" min="0" max="210" value={options.tolerance} onChange={e => updateOption('tolerance', Number(e.target.value))} />
          </Control>

          <Control label="Padding do recorte" value={options.padding}>
            <input type="range" min="0" max="40" value={options.padding} onChange={e => updateOption('padding', Number(e.target.value))} />
          </Control>

          <Control label="Área mínima" value={options.minArea}>
            <input type="number" min="1" value={options.minArea} onChange={e => updateOption('minArea', Number(e.target.value))} />
          </Control>

          <Control label="Juntar partes próximas" value={options.mergeDistance}>
            <input type="range" min="0" max="35" value={options.mergeDistance} onChange={e => updateOption('mergeDistance', Number(e.target.value))} />
          </Control>

          <Control label="Espaço entre sprites" value={options.gapThreshold}>
            <input type="range" min="0" max="30" value={options.gapThreshold} onChange={e => updateOption('gapThreshold', Number(e.target.value))} />
          </Control>

          <div className="grid-2">
            <label className="field">
              Largura mín.
              <input type="number" min="1" value={options.minSpriteWidth} onChange={e => updateOption('minSpriteWidth', Number(e.target.value))} />
            </label>
            <label className="field">
              Altura mín.
              <input type="number" min="1" value={options.minSpriteHeight} onChange={e => updateOption('minSpriteHeight', Number(e.target.value))} />
            </label>
          </div>

          <div className="check-list">
            <label><input type="checkbox" checked={options.pixelArt} onChange={e => updateOption('pixelArt', e.target.checked)} /> Modo pixel art</label>
            <label><input type="checkbox" checked={options.removeSmallNoise} onChange={e => updateOption('removeSmallNoise', e.target.checked)} /> Remover ruído pequeno</label>
            <label><input type="checkbox" checked={options.ignoreThinLines} onChange={e => updateOption('ignoreThinLines', e.target.checked)} /> Ignorar linhas divisórias</label>
            <label><input type="checkbox" checked={options.ignoreText} onChange={e => updateOption('ignoreText', e.target.checked)} /> Ignorar textos pequenos</label>
            <label><input type="checkbox" checked={options.ignoreLargePortraits} onChange={e => updateOption('ignoreLargePortraits', e.target.checked)} /> Ignorar retratos grandes</label>
            <label><input type="checkbox" checked={options.splitLargeEffects} onChange={e => updateOption('splitLargeEffects', e.target.checked)} /> Separar efeitos grandes</label>
          </div>

          <label className="field">
            Escala de exportação
            <select value={options.exportScale} onChange={e => updateOption('exportScale', Number(e.target.value))}>
              <option value={1}>1x original</option>
              <option value={2}>2x pixel perfect</option>
              <option value={3}>3x pixel perfect</option>
              <option value={4}>4x pixel perfect</option>
              <option value={8}>8x pixel perfect</option>
            </select>
          </label>

          <label className="field">
            Fundo do preview
            <select value={previewBg} onChange={e => setPreviewBg(e.target.value as any)}>
              <option value="transparent">Transparente</option>
              <option value="black">Preto</option>
              <option value="white">Branco</option>
            </select>
          </label>

          <div className="tool-grid">
            <button className="button wide strong" onClick={runDetection} disabled={!file}><Wand2 size={16} /> Auto detectar tudo</button>
            <button className="button wide" onClick={runProjectionOnly} disabled={!file}><ScanSearch size={16} /> Detectar por linhas</button>
            <button className="button wide" onClick={runConnectedOnly} disabled={!file}><Boxes size={16} /> Detectar por pixels</button>
            <button className="button wide" onClick={detectByGrid} disabled={!file}><Grid2X2 size={16} /> Detectar por grade</button>
            <button className="button wide" onClick={addManualBox} disabled={!file}><Plus size={16} /> Caixa manual</button>
            <button className="button wide" onClick={() => refreshPreviews()} disabled={!file}><Sparkles size={16} /> Atualizar previews</button>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-toolbar">
            <div className="stage-toolbar-left">
              <strong>{lang === 'pt' ? 'Visualizador da spritesheet' : 'Spritesheet viewer'}</strong>
              <span>{imageSize.width ? `${imageSize.width}x${imageSize.height}px` : lang === 'pt' ? 'Nenhuma imagem carregada' : 'No image loaded'}</span>
            </div>

            <div className="zoom-controls">
              <button className="zoom-button" onClick={zoomOut} disabled={!file} title={lang === 'pt' ? 'Diminuir zoom' : 'Zoom out'}>
                <ZoomOut size={16} />
              </button>
              <span className="zoom-value">{Math.round(zoom * 100)}%</span>
              <button className="zoom-button" onClick={zoomIn} disabled={!file} title={lang === 'pt' ? 'Aumentar zoom' : 'Zoom in'}>
                <ZoomIn size={16} />
              </button>
              <button className="zoom-button reset" onClick={resetZoom} disabled={!file}>
                <RotateCcw size={16} /> {lang === 'pt' ? 'Resetar' : 'Reset'}
              </button>
            </div>
          </div>

          <div className="stage-scroll">
            {!file && (
              <div className="empty">
                <ImageUp size={56} />
                <h2>{lang === 'pt' ? 'Envie uma spritesheet' : 'Upload a spritesheet'}</h2>
                <p>{lang === 'pt' ? 'PNG, JPG, JPEG ou WEBP. O app tenta detectar automaticamente logo após o upload.' : 'PNG, JPG, JPEG, or WEBP. The app tries to detect sprites automatically after upload.'}</p>
                <small>{lang === 'pt' ? 'Pode instalar como PWA pelo navegador.' : 'Can be installed as a PWA from the browser.'}</small>
              </div>
            )}

            {file && imageUrl && (
              <div
                className={`preview-wrap ${options.pixelArt ? 'pixelated' : ''}`}
                style={{
                  width: `${imageSize.width * zoom}px`,
                  height: `${imageSize.height * zoom}px`
                }}
              >
                <img
                  src={imageUrl}
                  className="source-image"
                  alt="Spritesheet enviada"
                  onLoad={() => requestAnimationFrame(() => redrawOverlay(boxes))}
                />
                <canvas
                  ref={overlayCanvasRef}
                  className={`overlay ${selectBgMode ? 'picker' : ''}`}
                  onMouseDown={handlePointerDown}
                  onMouseMove={handlePointerMove}
                  onMouseUp={handlePointerUp}
                  onMouseLeave={handlePointerUp}
                />
              </div>
            )}
          </div>
        </section>

        <aside className="panel right">
          <div className="panel-title-row">
            <h2>Sprites detectadas</h2>
            <span className="badge">{sprites.length}</span>
          </div>

          <div className="method-box">
            <span>Método:</span>
            <strong>{lastMethod}</strong>
          </div>

          <div className={`sprite-list bg-${previewBg}`}>
            {sprites.map((sprite) => (
              <div className="sprite-card" key={sprite.id}>
                <div className="thumb">
                  <img src={sprite.dataUrl} alt={sprite.name} />
                </div>
                <div className="sprite-info">
                  <input value={sprite.name.replace(/\.png$/, '')} onChange={e => updateBoxName(sprite.id, e.target.value)} />
                  <span>{sprite.width}x{sprite.height}px • {sprite.method || lastMethod}</span>
                  <div className="mini-actions">
                    <a download={sprite.name} href={sprite.dataUrl} className="mini-button"><Save size={14} /> PNG</a>
                    <button className="mini-button danger" onClick={() => deleteBox(sprite.id)}><X size={14} /> Excluir</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </main>

      <footer className="statusbar">
        <span>{status}</span>
        <span>Imagem: {imageSize.width ? `${imageSize.width}x${imageSize.height}px` : '-'}</span>
        <span>Sprites: {boxes.length}</span>
      </footer>

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>
                {modal === 'help' && (lang === 'pt' ? 'Como usar' : 'How to use')}
                {modal === 'report' && (lang === 'pt' ? 'Reportar problema' : 'Report issue')}
                {modal === 'credits' && (lang === 'pt' ? 'Créditos do projeto' : 'Project credits')}
              </h2>
              <button className="icon-button" onClick={() => setModal(null)}><X size={18} /></button>
            </div>

            {modal === 'help' && (
              <div className="modal-body">
                <p>{lang === 'pt' ? '1. Clique em Upload e envie uma spritesheet.' : '1. Click Upload and choose a spritesheet.'}</p>
                <p>{lang === 'pt' ? '2. O app roda a detecção automática sozinho.' : '2. The app runs auto detection automatically.'}</p>
                <p>{lang === 'pt' ? '3. Se o fundo ficar errado, clique em Selecionar fundo e clique numa área vazia.' : '3. If the background is wrong, pick the background and click an empty area.'}</p>
                <p>{lang === 'pt' ? '4. Use os presets e ajuste tolerância, área mínima e juntar partes próximas.' : '4. Use presets and adjust tolerance, minimum area and merge nearby parts.'}</p>
                <p>{lang === 'pt' ? '5. Exporte tudo em ZIP com PNG transparente.' : '5. Export everything as ZIP with transparent PNGs.'}</p>
              </div>
            )}

            {modal === 'report' && (
              <div className="modal-body">
                <p>{lang === 'pt' ? 'Para reportar bug ou sugestão, use o GitHub Issues. Antes de publicar, troque o link no App.tsx para seu repositório oficial.' : 'To report a bug or suggestion, use GitHub Issues. Before publishing, replace the link in App.tsx with your official repository.'}</p>
                <a className="button primary" href={REPORT_URL} target="_blank" rel="noreferrer">{lang === 'pt' ? 'Abrir issue no GitHub' : 'Open GitHub issue'}</a>
              </div>
            )}

            {modal === 'credits' && (
              <div className="modal-body">
                <p>Sprite Cutter Pro</p>
                <p>{lang === 'pt' ? 'Criado por VeryHardgg, com apoio do ChatGPT, para ajudar spriters, criadores de servidores de Ragnarok Online, pixel artists, modders e devs de jogos 2D.' : 'Created by VeryHardgg, with support from ChatGPT, to help spriters, Ragnarok Online server creators, pixel artists, modders and 2D game developers.'}</p>
                <p>{lang === 'pt' ? 'Privacidade: processamento 100% local.' : 'Privacy: 100% local processing.'}</p>
              </div>
            )}

            <button className="button modal-close" onClick={() => setModal(null)}>{lang === 'pt' ? 'Fechar' : 'Close'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Control({ label, value, children }: { label: string; value: number; children: React.ReactNode }) {
  return (
    <label className="field">
      <div className="field-row">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      {children}
    </label>
  );
}
