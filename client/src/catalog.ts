// Catálogo de sprites do editor. Referência ao atlas: "col,row" (1×1) ou
// "col,row,w,h" (w×h células de 32px). Os tamanhos foram medidos direto do
// atlas (bounding box das peças), não chutados.
//
// Camadas / como o map.json grava a escolha por célula:
//   - terrain  → tiles[row][col] (floor/wall/object);
//   - furniture→ célula vira `object` sólido + item em `decor` = {x,y,sprite};
//   - decal    → item em `decals` = {x,y,sprite} (face da parede).
// Para itens não-terreno, a CAMADA usada é o "modo de colagem" do editor
// (Móvel/Decal); `layer` aqui é só o padrão sugerido ao selecionar o item.

import { type TileType } from './collision.js';

export type Layer = 'terrain' | 'furniture' | 'decal';

export interface CatalogItem {
  id: string;
  label: string;
  category: string;
  sprite: string;
  layer: Layer;
  tile?: TileType;
}

export const CATALOG: readonly CatalogItem[] = [
  // Terreno (base / colisão)
  { id: 'floor', label: 'Piso', category: 'Terreno', sprite: '1,2', layer: 'terrain', tile: 'floor' },
  { id: 'wall', label: 'Parede', category: 'Terreno', sprite: '2,0', layer: 'terrain', tile: 'wall' },
  { id: 'object', label: 'Bloco sólido', category: 'Terreno', sprite: '11,2', layer: 'terrain', tile: 'object' },

  // Assentos
  { id: 'chair-red', label: 'Cadeira vermelha', category: 'Assentos', sprite: '10,3', layer: 'furniture' },
  { id: 'chair-blue', label: 'Cadeira azul', category: 'Assentos', sprite: '11,3', layer: 'furniture' },
  { id: 'chair-red2', label: 'Cadeira vermelha 2', category: 'Assentos', sprite: '10,4', layer: 'furniture' },
  { id: 'chair-blue2', label: 'Cadeira azul 2', category: 'Assentos', sprite: '11,4', layer: 'furniture' },
  { id: 'stool-red', label: 'Banco vermelho', category: 'Assentos', sprite: '10,5', layer: 'furniture' },
  { id: 'stool-blue', label: 'Banco azul', category: 'Assentos', sprite: '11,5', layer: 'furniture' },
  { id: 'seat-red', label: 'Assento vermelho', category: 'Assentos', sprite: '10,2', layer: 'furniture' },
  { id: 'seat-blue', label: 'Assento azul', category: 'Assentos', sprite: '11,2', layer: 'furniture' },

  // Mesas / consoles
  { id: 'desk', label: 'Bancada branca', category: 'Mesas', sprite: '12,5,2,1', layer: 'furniture' },
  { id: 'console-blue', label: 'Console triplo azul', category: 'Mesas', sprite: '6,2,3,1', layer: 'furniture' },
  { id: 'console-orange', label: 'Console triplo laranja', category: 'Mesas', sprite: '6,3,3,1', layer: 'furniture' },
  { id: 'table-white', label: 'Mesa branca', category: 'Mesas', sprite: '13,2,2,2', layer: 'furniture' },
  { id: 'stove', label: 'Fogão', category: 'Mesas', sprite: '12,2', layer: 'furniture' },
  { id: 'ctrl-panel', label: 'Painel de controle', category: 'Mesas', sprite: '12,3', layer: 'furniture' },

  // Camas
  { id: 'bed-blue', label: 'Cama azul', category: 'Camas', sprite: '8,9,2,2', layer: 'furniture' },
  { id: 'bed-orange', label: 'Cama laranja', category: 'Camas', sprite: '10,9,2,2', layer: 'furniture' },
  { id: 'pod', label: 'Pod branco', category: 'Camas', sprite: '6,9,2,2', layer: 'furniture' },

  // Cozinha
  { id: 'counter1', label: 'Balcão pia', category: 'Cozinha', sprite: '6,5,1,2', layer: 'furniture' },
  { id: 'counter2', label: 'Balcão facas', category: 'Cozinha', sprite: '7,5,1,2', layer: 'furniture' },
  { id: 'counter3', label: 'Balcão garrafas', category: 'Cozinha', sprite: '8,5,1,2', layer: 'furniture' },
  { id: 'sink1', label: 'Pia', category: 'Cozinha', sprite: '13,1', layer: 'furniture' },
  { id: 'sink2', label: 'Pia com água', category: 'Cozinha', sprite: '14,1', layer: 'furniture' },

  // Eletrônicos
  { id: 'rack1', label: 'Rack servidor', category: 'Eletrônicos', sprite: '16,3,2,1', layer: 'furniture' },
  { id: 'rack2', label: 'Rack servidor 2', category: 'Eletrônicos', sprite: '16,4,2,1', layer: 'furniture' },
  { id: 'rack3', label: 'Rack servidor 3', category: 'Eletrônicos', sprite: '16,5,2,1', layer: 'furniture' },
  { id: 'rack4', label: 'Rack servidor 4', category: 'Eletrônicos', sprite: '16,6,2,1', layer: 'furniture' },
  { id: 'tv-cyan', label: 'TV ciano', category: 'Eletrônicos', sprite: '12,7,2,2', layer: 'furniture' },
  { id: 'tv-red', label: 'TV vermelha', category: 'Eletrônicos', sprite: '14,7,2,2', layer: 'furniture' },
  { id: 'arcade', label: 'Arcade', category: 'Eletrônicos', sprite: '19,3', layer: 'furniture' },
  { id: 'shelf1', label: 'Prateleira', category: 'Eletrônicos', sprite: '8,1', layer: 'furniture' },
  { id: 'shelf2', label: 'Prateleira 2', category: 'Eletrônicos', sprite: '9,1', layer: 'furniture' },

  // Diversos
  { id: 'crate', label: 'Engradado', category: 'Diversos', sprite: '19,5', layer: 'furniture' },
  { id: 'extinguisher', label: 'Extintor', category: 'Diversos', sprite: '18,5', layer: 'furniture' },
  { id: 'pillow', label: 'Almofada', category: 'Diversos', sprite: '18,6', layer: 'furniture' },
  { id: 'dumbbell-blue', label: 'Halteres azul', category: 'Diversos', sprite: '12,9,2,1', layer: 'furniture' },
  { id: 'dumbbell-orange', label: 'Halteres laranja', category: 'Diversos', sprite: '12,10,2,1', layer: 'furniture' },
  { id: 'gear-blue', label: 'Mochila/kit', category: 'Diversos', sprite: '10,7', layer: 'furniture' },
  { id: 'gear-blue2', label: 'Mochila/kit 2', category: 'Diversos', sprite: '11,7', layer: 'furniture' },
  { id: 'bar-red', label: 'Barra vermelha', category: 'Diversos', sprite: '12,6,2,1', layer: 'furniture' },
  { id: 'pizza', label: 'Prato/pizza', category: 'Diversos', sprite: '16,7', layer: 'furniture' },
  { id: 'bowl', label: 'Tigela', category: 'Diversos', sprite: '17,7', layer: 'furniture' },
  { id: 'plate', label: 'Prato', category: 'Diversos', sprite: '18,7', layer: 'furniture' },
  { id: 'mug', label: 'Caneca', category: 'Diversos', sprite: '19,7', layer: 'furniture' },
  { id: 'cup', label: 'Copo', category: 'Diversos', sprite: '19,8', layer: 'furniture' },

  // Decals de parede
  { id: 'mon-orange', label: 'Monitor laranja', category: 'Decals', sprite: '6,0', layer: 'decal' },
  { id: 'mon-blue', label: 'Monitor azul', category: 'Decals', sprite: '7,0', layer: 'decal' },
  { id: 'panel-orange', label: 'Painel laranja', category: 'Decals', sprite: '6,1', layer: 'decal' },
  { id: 'panel-blue', label: 'Painel azul', category: 'Decals', sprite: '7,1', layer: 'decal' },
  { id: 'panel-text', label: 'Painel texto', category: 'Decals', sprite: '11,1', layer: 'decal' },
  { id: 'fan', label: 'Console ventoinha', category: 'Decals', sprite: '8,0,2,1', layer: 'decal' },
  { id: 'neon-home', label: 'Neon HOME', category: 'Decals', sprite: '13,0,2,1', layer: 'decal' },
  { id: 'frame-orange', label: 'Moldura laranja', category: 'Decals', sprite: '15,0,3,1', layer: 'decal' },
  { id: 'frame-pink', label: 'Moldura rosa', category: 'Decals', sprite: '15,1,3,1', layer: 'decal' },
  { id: 'frame-cyan', label: 'Moldura ciano', category: 'Decals', sprite: '15,2,3,1', layer: 'decal' },
  { id: 'window-purple', label: 'Janela cidade roxa', category: 'Decals', sprite: '18,0,3,1', layer: 'decal' },
  { id: 'window-pink', label: 'Janela cidade rosa', category: 'Decals', sprite: '18,1,3,1', layer: 'decal' },
  { id: 'window-cyan', label: 'Janela cidade ciano', category: 'Decals', sprite: '18,2,3,1', layer: 'decal' },
  { id: 'door-orange', label: 'Porta laranja', category: 'Decals', sprite: '6,7,1,2', layer: 'decal' },
  { id: 'door-dark', label: 'Porta escura', category: 'Decals', sprite: '7,7,1,2', layer: 'decal' },
];

/** Categorias curadas, na ordem de exibição. O editor adiciona depois a
 *  categoria dinâmica "Atlas (células)" com TODAS as células ocupadas. */
export const CATEGORIES: readonly string[] = [
  'Terreno',
  'Assentos',
  'Mesas',
  'Camas',
  'Cozinha',
  'Eletrônicos',
  'Diversos',
  'Decals',
];

export const ATLAS_CATEGORY = 'Atlas (células)';
