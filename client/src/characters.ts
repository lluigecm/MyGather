// Registro dos personagens disponíveis (Etapa 8).
// Combinações fixas (não é customização livre): 4 spritesheets versionados.

import { CharacterSprite, loadCharacterSprite } from './spritesheet.js';

// URLs resolvidas pelo Vite (hash no build, caminho no dev).
const sheetUrls = import.meta.glob('./assets/characters/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface CharacterOption {
  id: string; // ex.: "char-1"
  label: string; // ex.: "Personagem 1"
  url: string;
}

/** Lista ordenada e estável dos personagens (id = nome do arquivo sem extensão). */
export const CHARACTERS: CharacterOption[] = Object.entries(sheetUrls)
  .map(([path, url]) => {
    const id = path.split('/').pop()!.replace(/\.png$/i, '');
    const n = id.match(/(\d+)/)?.[1] ?? id;
    return { id, label: `Personagem ${n}`, url };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export const DEFAULT_CHARACTER = CHARACTERS[0]?.id ?? 'char-1';

/** Garante que um id é válido; senão devolve o padrão. */
export function normalizeCharacter(id: string | null | undefined): string {
  return CHARACTERS.some((c) => c.id === id) ? (id as string) : DEFAULT_CHARACTER;
}

/** Carrega todos os sprites (para renderizar qualquer escolha de qualquer peer). */
export async function loadAllCharacters(): Promise<Map<string, CharacterSprite>> {
  const entries = await Promise.all(
    CHARACTERS.map(async (c) => {
      try {
        return [c.id, await loadCharacterSprite(c.url)] as const;
      } catch (err) {
        console.warn(`[characters] ${c.id} não carregou:`, err);
        return null;
      }
    })
  );
  return new Map(entries.filter((e): e is [string, CharacterSprite] => e !== null));
}
