// Editor visual de mapas (navegador). Desenha o mapa EXATAMENTE como o jogo
// (WYSIWYG): parede de 2 fileiras com cap, camadas piso→objeto→móvel, decals de
// parede. Paleta de sprites do catálogo, ferramentas de pincel/retângulo/decal/
// spawn/sala, undo/redo e validação ao vivo do cerco (piso exposto ao vazio).
//
// Modelo no map.json:
//   - tiles[row][col]       → floor/wall/object (colisão + base);
//   - decor  = {x,y,sprite} → móvel de chão (célula vira `object` sólido);
//   - decals = {x,y,sprite} → decal na face da parede;
//   - tileStyles, spawn, rooms → como antes.

import { type MapData, type TileType, type RoomZone, type DecorItem } from './collision.js';
import { validateMap, safeValidateMap } from './mapschema.js';
import { TILE_COLORS } from './tilestyle.js';
import {
  drawTile,
  drawWallCell,
  drawDecor,
  loadTileset,
  parseAtlasRef,
  VOID_DEEP,
} from './tileset.js';
import { CATALOG, CATEGORIES, ATLAS_CATEGORY, type CatalogItem } from './catalog.js';

type Tool = 'paint' | 'rect' | 'erase' | 'spawn' | 'room';
type PlaceMode = 'furniture' | 'decal';

const canvas = document.getElementById('editor') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const statusEl = document.getElementById('status') as HTMLElement;
const roomsListEl = document.getElementById('rooms-list') as HTMLElement;
const toolsEl = document.getElementById('tools') as HTMLElement;
const paletteEl = document.getElementById('palette') as HTMLElement;
const placeModeEl = document.getElementById('place-mode') as HTMLElement;

let map: MapData = blankMap(30, 20, 32);
let tool: Tool = 'paint';
let brush: CatalogItem = CATALOG[1]; // Parede por padrão
let placeMode: PlaceMode = 'furniture'; // como colar itens não-terreno
// Itens/categorias da paleta: curados + (após carregar o atlas) todas as células.
let allItems: CatalogItem[] = [...CATALOG];
let categories: string[] = [...CATEGORIES];
let painting = false;
let atlas: HTMLImageElement | null = null;
let roomDrag: { c0: number; r0: number; c1: number; r1: number } | null = null;
let rectDrag: { c0: number; r0: number; c1: number; r1: number } | null = null;
let hover: { col: number; row: number } | null = null;

// Undo/redo: pilhas de snapshots do mapa (mapa é pequeno → clone simples).
const undoStack: MapData[] = [];
const redoStack: MapData[] = [];
const MAX_UNDO = 60;

void loadTileset().then((img) => {
  atlas = img;
  // Com o atlas em mãos, adiciona a categoria dinâmica com TODAS as células
  // ocupadas do atlas (liberdade total pra montar qualquer peça).
  const cells = detectAtlasCells();
  if (cells.length) {
    allItems = [...CATALOG, ...cells];
    categories = [...CATEGORIES, ATLAS_CATEGORY];
  }
  buildPalette();
  buildPaletteThumbs();
  markSelectedBrush();
  render();
});

/** Toda célula 32×32 do atlas com algum pixel não-transparente vira um item 1×1. */
function detectAtlasCells(): CatalogItem[] {
  if (!atlas) return [];
  const off = document.createElement('canvas');
  off.width = atlas.width;
  off.height = atlas.height;
  const c = off.getContext('2d')!;
  c.drawImage(atlas, 0, 0);
  const { data } = c.getImageData(0, 0, atlas.width, atlas.height);
  const cols = Math.floor(atlas.width / 32);
  const rows = Math.floor(atlas.height / 32);
  const items: CatalogItem[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let occupied = false;
      for (let y = row * 32; y < row * 32 + 32 && !occupied; y++) {
        for (let x = col * 32; x < col * 32 + 32; x++) {
          if (data[(y * atlas.width + x) * 4 + 3] > 30) {
            occupied = true;
            break;
          }
        }
      }
      if (occupied) {
        items.push({
          id: `cell_${col}_${row}`,
          label: `${col},${row}`,
          category: ATLAS_CATEGORY,
          sprite: `${col},${row}`,
          layer: 'furniture',
        });
      }
    }
  }
  return items;
}

// --- Modelo ----------------------------------------------------------------

function blankMap(width: number, height: number, tileSize: number): MapData {
  // Caixa fechada: borda de parede (o "vazio") + piso no miolo — já respeita a
  // regra de cerco (nenhum piso encosta na borda do mapa).
  const tiles: TileType[][] = Array.from({ length: height }, (_r, row) =>
    Array.from({ length: width }, (_c, col) =>
      row === 0 || row === height - 1 || col === 0 || col === width - 1
        ? ('wall' as TileType)
        : ('floor' as TileType)
    )
  );
  const spawn = { x: Math.min(1, width - 1), y: Math.min(1, height - 1) };
  return { tileSize, width, height, spawn, rooms: [], tiles, tileStyles: defaultTileStyles(), decor: [], decals: [] };
}

function defaultTileStyles(): NonNullable<MapData['tileStyles']> {
  return {
    floor: { color: TILE_COLORS.floor, sprite: '1,2' },
    wall: { color: TILE_COLORS.wall, sprite: '2,1' },
    object: { color: TILE_COLORS.object, sprite: '11,2' },
  };
}

const cloneMap = (m: MapData): MapData =>
  typeof structuredClone === 'function'
    ? structuredClone(m)
    : (JSON.parse(JSON.stringify(m)) as MapData);

// --- Undo/redo -------------------------------------------------------------

/** Guarda o estado ATUAL antes de uma mutação (chamar 1x por interação). */
function pushUndo(): void {
  undoStack.push(cloneMap(map));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}
function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(cloneMap(map));
  map = prev;
  afterStructuralChange('Desfeito.');
}
function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneMap(map));
  map = next;
  afterStructuralChange('Refeito.');
}
function afterStructuralChange(msg: string): void {
  map.rooms ??= [];
  map.decor ??= [];
  map.decals ??= [];
  fitCanvas();
  renderRoomsList();
  render();
  liveValidate(msg);
}

// --- Render (WYSIWYG) ------------------------------------------------------

function fitCanvas(): void {
  canvas.width = map.width * map.tileSize;
  canvas.height = map.height * map.tileSize;
}

function render(): void {
  const ts = map.tileSize;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = VOID_DEEP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const decorCells = new Set((map.decor ?? []).map((d) => `${d.x},${d.y}`));

  // Fases (IGUAL ao jogo): piso → objeto → parede (2 fileiras).
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const type = map.tiles[row][col];
      if (type === 'floor' || type === 'object') {
        drawTile(ctx, atlas, map, 'floor', col, row, col * ts, row * ts, ts);
      }
      if (type === 'object' && !decorCells.has(`${col},${row}`)) {
        drawTile(ctx, atlas, map, 'object', col, row, col * ts, row * ts, ts);
      }
    }
    for (let col = 0; col < map.width; col++) {
      if (map.tiles[row][col] === 'wall') {
        drawWallCell(ctx, atlas, map, col, row, col * ts, row * ts, ts);
      }
    }
  }

  // Móveis de chão + decals de parede (camadas do jogo).
  for (const item of map.decor ?? []) drawDecor(ctx, atlas, item, item.x * ts, item.y * ts, ts);
  for (const item of map.decals ?? []) drawDecor(ctx, atlas, item, item.x * ts, item.y * ts, ts);

  // --- A partir daqui: OVERLAYS só do editor (não existem no jogo). ---

  // Grade.
  ctx.strokeStyle = 'rgba(0,255,255,0.15)';
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) ctx.strokeRect(col * ts + 0.5, row * ts + 0.5, ts, ts);
  }

  // Validação ao vivo: piso/objeto exposto ao vazio (borda do mapa) em vermelho.
  ctx.fillStyle = 'rgba(255, 40, 40, 0.45)';
  ctx.strokeStyle = 'rgba(255, 80, 80, 0.95)';
  ctx.lineWidth = 2;
  for (const [col, row] of exposedCells()) {
    ctx.fillRect(col * ts, row * ts, ts, ts);
    ctx.strokeRect(col * ts + 1, row * ts + 1, ts - 2, ts - 2);
  }

  // Zonas de sala (overlay roxo tracejado — SÓ no editor).
  for (const r of map.rooms ?? []) {
    ctx.fillStyle = 'rgba(126, 87, 194, 0.20)';
    ctx.fillRect(r.x * ts, r.y * ts, r.width * ts, r.height * ts);
    ctx.strokeStyle = 'rgba(179, 157, 219, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x * ts + 1, r.y * ts + 1, r.width * ts - 2, r.height * ts - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(209, 196, 233, 0.95)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(r.roomId, r.x * ts + 5, r.y * ts + 14);
  }

  // Prévia de arraste (sala ou retângulo).
  const preview = roomDrag ? dragToZone(roomDrag) : rectDrag ? dragToZone(rectDrag) : null;
  if (preview) {
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(preview.x * ts + 1, preview.y * ts + 1, preview.width * ts - 2, preview.height * ts - 2);
    ctx.setLineDash([]);
  }

  // Spawn.
  const sx = map.spawn.x * ts + ts / 2;
  const sy = map.spawn.y * ts + ts / 2;
  ctx.strokeStyle = '#4caf50';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(6, ts / 3), 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#4caf50';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('spawn', map.spawn.x * ts + 2, map.spawn.y * ts + 11);

  // Prévia (ghost) do pincel sob o cursor.
  if (hover && !roomDrag && !rectDrag && !painting) {
    const { col, row } = hover;
    ctx.save();
    if (tool === 'erase') {
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = 2;
      ctx.strokeRect(col * ts + 1, row * ts + 1, ts - 2, ts - 2);
    } else if (tool === 'paint' || tool === 'rect') {
      if (brush.layer === 'terrain') {
        ctx.strokeStyle = '#ffb74d';
        ctx.lineWidth = 2;
        ctx.strokeRect(col * ts + 1, row * ts + 1, ts - 2, ts - 2);
      } else {
        ctx.globalAlpha = 0.55;
        drawDecor(ctx, atlas, { x: col, y: row, sprite: brush.sprite }, col * ts, row * ts, ts);
      }
    }
    ctx.restore();
  }
}

/** Células caminháveis (floor/object) na borda do mapa → expostas ao vazio. */
function exposedCells(): [number, number][] {
  const out: [number, number][] = [];
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const t = map.tiles[row][col];
      if (t !== 'floor' && t !== 'object') continue;
      if (row === 0 || row === map.height - 1 || col === 0 || col === map.width - 1) out.push([col, row]);
    }
  }
  return out;
}

// --- Edição de camadas -----------------------------------------------------

function decorIndexAt(col: number, row: number): number {
  return (map.decor ?? []).findIndex((d) => d.x === col && d.y === row);
}
function decalIndexAt(col: number, row: number): number {
  return (map.decals ?? []).findIndex((d) => d.x === col && d.y === row);
}
function footprint(sprite: string): { w: number; h: number } {
  const ref = parseAtlasRef(sprite);
  return { w: ref?.w ?? 1, h: ref?.h ?? 1 };
}

function setTile(col: number, row: number, type: TileType): void {
  map.tiles[row][col] = type;
  // Pintar parede/piso sob um móvel remove o móvel (não faz sentido manter).
  if (type !== 'object') {
    const di = decorIndexAt(col, row);
    if (di >= 0) map.decor!.splice(di, 1);
  }
}

function placeFurniture(col: number, row: number, item: CatalogItem): void {
  const { w, h } = footprint(item.sprite);
  // Marca a pegada como objeto sólido (dentro dos limites) e limpa decor solto.
  for (let r = row; r < row + h && r < map.height; r++) {
    for (let c = col; c < col + w && c < map.width; c++) {
      map.tiles[r][c] = 'object';
      if (!(c === col && r === row)) {
        const di = decorIndexAt(c, r);
        if (di >= 0) map.decor!.splice(di, 1);
      }
    }
  }
  const existing = decorIndexAt(col, row);
  const entry: DecorItem = { x: col, y: row, sprite: item.sprite };
  if (existing >= 0) map.decor![existing] = entry;
  else (map.decor ??= []).push(entry);
}

function placeDecal(col: number, row: number, item: CatalogItem): void {
  const entry: DecorItem = { x: col, y: row, sprite: item.sprite };
  const existing = decalIndexAt(col, row);
  if (existing >= 0) map.decals![existing] = entry;
  else (map.decals ??= []).push(entry);
}

function eraseAt(col: number, row: number): void {
  const dl = decalIndexAt(col, row);
  if (dl >= 0) {
    map.decals!.splice(dl, 1);
    return; // apaga o decal primeiro; a base fica
  }
  const di = decorIndexAt(col, row);
  if (di >= 0) {
    const { w, h } = footprint(map.decor![di].sprite);
    for (let r = row; r < row + h && r < map.height; r++)
      for (let c = col; c < col + w && c < map.width; c++) map.tiles[r][c] = 'floor';
    map.decor!.splice(di, 1);
    return;
  }
  map.tiles[row][col] = 'floor';
}

/** Aplica o pincel atual (ou apagar) numa célula. */
function applyAt(col: number, row: number): void {
  if (tool === 'erase') return eraseAt(col, row);
  if (tool === 'spawn') {
    if (map.tiles[row][col] !== 'floor') {
      setStatus('O spawn precisa ficar sobre um piso.', 'error');
      return;
    }
    map.spawn = { x: col, y: row };
    return;
  }
  // Pincel: terreno vai para tiles; o resto usa o modo de colagem (Móvel/Decal).
  if (brush.layer === 'terrain' && brush.tile) setTile(col, row, brush.tile);
  else if (placeMode === 'decal') placeDecal(col, row, brush);
  else placeFurniture(col, row, brush);
}

// --- Interação -------------------------------------------------------------

function tileAt(e: MouseEvent): { col: number; row: number } | null {
  const rect = canvas.getBoundingClientRect();
  const col = Math.floor(((e.clientX - rect.left) * (canvas.width / rect.width)) / map.tileSize);
  const row = Math.floor(((e.clientY - rect.top) * (canvas.height / rect.height)) / map.tileSize);
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) return null;
  return { col, row };
}

canvas.addEventListener('mousedown', (e) => {
  const t = tileAt(e);
  if (!t) return;
  if (tool === 'room') {
    roomDrag = { c0: t.col, r0: t.row, c1: t.col, r1: t.row };
  } else if (tool === 'rect') {
    rectDrag = { c0: t.col, r0: t.row, c1: t.col, r1: t.row };
  } else {
    pushUndo();
    painting = true;
    applyAt(t.col, t.row);
    render();
  }
});
canvas.addEventListener('mousemove', (e) => {
  const t = tileAt(e);
  hover = t;
  if (!t) return void render();
  if (roomDrag) {
    roomDrag.c1 = t.col;
    roomDrag.r1 = t.row;
    render();
  } else if (rectDrag) {
    rectDrag.c1 = t.col;
    rectDrag.r1 = t.row;
    render();
  } else if (painting) {
    applyAt(t.col, t.row);
    render();
  } else {
    render(); // atualiza a prévia (ghost) sob o cursor
  }
});
canvas.addEventListener('mouseleave', () => {
  hover = null;
  render();
});
window.addEventListener('mouseup', () => {
  if (roomDrag) {
    const zone = dragToZone(roomDrag);
    roomDrag = null;
    const roomId = (window.prompt('Nome da sala (roomId):', 'sala') ?? '').trim();
    if (roomId) {
      pushUndo();
      (map.rooms ??= []).push({ ...zone, roomId });
      renderRoomsList();
    }
    render();
  } else if (rectDrag) {
    const zone = dragToZone(rectDrag);
    rectDrag = null;
    pushUndo();
    for (let r = zone.y; r < zone.y + zone.height; r++)
      for (let c = zone.x; c < zone.x + zone.width; c++) applyAt(c, r);
    liveValidate();
    render();
  }
  if (painting) {
    painting = false;
    liveValidate();
  }
});

// --- Salas -----------------------------------------------------------------

function dragToZone(d: { c0: number; r0: number; c1: number; r1: number }): RoomZone {
  const x = Math.min(d.c0, d.c1);
  const y = Math.min(d.r0, d.r1);
  return { roomId: '', x, y, width: Math.abs(d.c1 - d.c0) + 1, height: Math.abs(d.r1 - d.r0) + 1 };
}

function renderRoomsList(): void {
  roomsListEl.textContent = '';
  const rooms = map.rooms ?? [];
  if (rooms.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = 'Nenhuma sala.';
    roomsListEl.appendChild(empty);
    return;
  }
  rooms.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'room';
    const name = document.createElement('span');
    name.textContent = `${r.roomId} (${r.width}×${r.height})`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Remover sala';
    del.addEventListener('click', () => {
      pushUndo();
      map.rooms?.splice(i, 1);
      renderRoomsList();
      render();
    });
    el.append(name, del);
    roomsListEl.appendChild(el);
  });
}

// --- Ferramentas + Paleta --------------------------------------------------

function selectTool(next: Tool): void {
  tool = next;
  for (const b of toolsEl.querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.tool === next);
  }
  setStatus(toolHint(next), '');
}
function toolHint(t: Tool): string {
  return {
    paint: 'Pincel: clique/arraste para pintar o item selecionado.',
    rect: 'Retângulo: arraste para preencher uma área com o item.',
    erase: 'Apagar: remove decal/móvel; senão vira piso.',
    spawn: 'Spawn: clique num piso.',
    room: 'Sala: arraste um retângulo e dê um roomId.',
  }[t];
}
toolsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  const action = btn?.dataset.action;
  if (action === 'undo') return undo();
  if (action === 'redo') return redo();
  const t = btn?.dataset.tool as Tool | undefined;
  if (t) selectTool(t);
});
placeModeEl.addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).closest('button')?.dataset.place as PlaceMode | undefined;
  if (m) setPlaceMode(m);
});

function markSelectedBrush(): void {
  for (const b of paletteEl.querySelectorAll('button')) {
    b.classList.toggle('sel', (b as HTMLElement).dataset.itemId === brush.id);
  }
}

function setPlaceMode(mode: PlaceMode): void {
  placeMode = mode;
  for (const b of placeModeEl.querySelectorAll('button')) {
    b.classList.toggle('active', (b as HTMLElement).dataset.place === mode);
  }
}

function selectBrush(item: CatalogItem): void {
  brush = item;
  // Escolher um sprite ativa o pincel (a menos que já esteja no retângulo).
  if (tool !== 'paint' && tool !== 'rect') selectTool('paint');
  // Terreno ignora o modo; decal/móvel definem o padrão do modo de colagem.
  if (item.layer === 'decal') setPlaceMode('decal');
  else if (item.layer === 'furniture') setPlaceMode('furniture');
  markSelectedBrush();
  const how = item.layer === 'terrain' ? 'terreno' : placeMode === 'decal' ? 'decal' : 'móvel';
  setStatus(`Pincel: ${item.label} — cola como ${how}.`, '');
}

/** Monta a paleta: seções por categoria + botões com thumbnail. */
function buildPalette(): void {
  paletteEl.textContent = '';
  for (const cat of categories) {
    const items = allItems.filter((i) => i.category === cat);
    if (items.length === 0) continue;
    const h = document.createElement('div');
    h.className = 'pal-cat';
    h.textContent = cat;
    paletteEl.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'pal-grid';
    for (const item of items) {
      const b = document.createElement('button');
      b.className = 'pal-item';
      b.dataset.itemId = item.id;
      b.title = `${item.label} — ${item.layer} (${item.sprite})`;
      const c = document.createElement('canvas');
      c.width = 36;
      c.height = 36;
      c.dataset.thumbFor = item.id;
      const cap = document.createElement('span');
      cap.textContent = item.label;
      b.append(c, cap);
      b.addEventListener('click', () => selectBrush(item));
      grid.appendChild(b);
    }
    paletteEl.appendChild(grid);
  }
}

/** Desenha os thumbnails da paleta (depois que o atlas carrega). */
function buildPaletteThumbs(): void {
  if (!atlas) return;
  for (const c of paletteEl.querySelectorAll('canvas')) {
    const canvasEl = c as HTMLCanvasElement;
    const item = allItems.find((i) => i.id === canvasEl.dataset.thumbFor);
    const ref = item && parseAtlasRef(item.sprite);
    const tctx = canvasEl.getContext('2d')!;
    tctx.imageSmoothingEnabled = false;
    tctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (!ref) continue;
    // Encaixa a peça (w×h tiles) no thumb 36×36 preservando proporção.
    const scale = Math.min(36 / (ref.w * 32), 36 / (ref.h * 32));
    const dw = ref.w * 32 * scale;
    const dh = ref.h * 32 * scale;
    tctx.drawImage(
      atlas,
      ref.col * 32,
      ref.row * 32,
      ref.w * 32,
      ref.h * 32,
      (36 - dw) / 2,
      (36 - dh) / 2,
      dw,
      dh
    );
  }
}

// --- Arquivo + status ------------------------------------------------------

function setStatus(msg: string, kind: 'ok' | 'error' | '' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}

/** Valida o mapa e reporta (não bloqueia). Chamada após cada mutação. */
function liveValidate(prefix = ''): void {
  const r = safeValidateMap({ ...map, tileStyles: map.tileStyles ?? defaultTileStyles() });
  const n = exposedCells().length;
  if (!r.ok) setStatus(`⚠ ${r.error}`, 'error');
  else if (n > 0) setStatus(`⚠ ${n} célula(s) de piso exposta(s) ao vazio (em vermelho).`, 'error');
  else setStatus(`${prefix} OK — piso cercado por parede.`.trim(), 'ok');
}

const arr = (items: readonly DecorItem[] | undefined): string =>
  `[\n${(items ?? []).map((d) => '    ' + JSON.stringify(d)).join(',\n')}\n  ]`;

/** Serializa no estilo legível do map.json — INCLUINDO decor e decals. */
function serializeMap(m: MapData): string {
  const styles = m.tileStyles ?? defaultTileStyles();
  return (
    '{\n' +
    `  "tileSize": ${m.tileSize},\n` +
    `  "width": ${m.width},\n` +
    `  "height": ${m.height},\n` +
    `  "spawn": ${JSON.stringify(m.spawn)},\n` +
    `  "rooms": [\n${(m.rooms ?? []).map((r) => '    ' + JSON.stringify(r)).join(',\n')}\n  ],\n` +
    `  "tileStyles": ${JSON.stringify(styles)},\n` +
    `  "decor": ${arr(m.decor)},\n` +
    `  "decals": ${arr(m.decals)},\n` +
    '  "tiles": [\n' +
    m.tiles.map((row) => '    ' + JSON.stringify(row)).join(',\n') +
    '\n  ]\n}\n'
  );
}

function doExport(): void {
  const out: MapData = { ...map, tileStyles: map.tileStyles ?? defaultTileStyles() };
  const result = safeValidateMap(out);
  if (!result.ok) {
    setStatus(`Não exportado — ${result.error}`, 'error');
    return;
  }
  const blob = new Blob([serializeMap(out)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Exportado como map.json ✓', 'ok');
}

function doImport(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch {
      setStatus('Arquivo não é um JSON válido.', 'error');
      return;
    }
    const result = safeValidateMap(parsed);
    if (!result.ok) {
      setStatus(`Mapa inválido — ${result.error}`, 'error');
      return;
    }
    undoStack.length = 0;
    redoStack.length = 0;
    map = result.map;
    map.rooms ??= [];
    map.decor ??= [];
    map.decals ??= [];
    fitCanvas();
    renderRoomsList();
    render();
    setStatus('Mapa importado ✓', 'ok');
  };
  reader.readAsText(file);
}

document.getElementById('btn-export')!.addEventListener('click', doExport);
const fileInput = document.getElementById('file-input') as HTMLInputElement;
document.getElementById('btn-import')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) doImport(f);
  fileInput.value = '';
});

document.getElementById('btn-new')!.addEventListener('click', () => {
  const w = clampInt('new-w', 1, 200);
  const h = clampInt('new-h', 1, 200);
  const ts = clampInt('new-ts', 8, 128);
  undoStack.length = 0;
  redoStack.length = 0;
  map = blankMap(w, h, ts);
  fitCanvas();
  renderRoomsList();
  render();
  setStatus(`Novo mapa ${w}×${h} criado.`, 'ok');
});

function clampInt(id: string, min: number, max: number): number {
  const v = Math.round(Number((document.getElementById(id) as HTMLInputElement).value));
  return Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
}

// Atalhos: Ctrl+Z desfaz, Ctrl+Y (ou Ctrl+Shift+Z) refaz.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
});

// --- Boot ------------------------------------------------------------------

buildPalette();
setPlaceMode('furniture');
selectBrush(brush);
selectTool('paint');
fitCanvas();
renderRoomsList();
render();
setStatus('Pronto. Escolha um sprite na paleta e pinte.', '');

// Guarda contra regressão do schema.
void validateMap({ ...map, tileStyles: defaultTileStyles() });
