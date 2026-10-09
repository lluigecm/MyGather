# Fase 2 · Melhorias de produto — Editor de mapas

Editor visual no navegador (em vez de importar do Tiled), porque `roomId`/`spawn`
são conceitos nossos, não nativos do Tiled — no editor eles são first-class.

## Usar

Abra `/editor.html` (ex.: `http://localhost:5173/editor.html`).

- **Pintar:** ferramentas Piso / Parede / Objeto / Apagar (clique ou arraste).
- **Spawn:** ferramenta Spawn → clique num piso.
- **Sala:** ferramenta Sala → arraste um retângulo → digite o `roomId`. A lista
  lateral mostra as salas com botão de remover.
- **Novo mapa:** define largura/altura/tile e cria em branco.
- **Importar / Exportar** `map.json`.

Fluxo no protótipo: editar → **Exportar map.json** → substituir
`client/src/map.json` → reiniciar o servidor (que lê o mesmo arquivo).

## Validação compartilhada

O editor valida com o **mesmo** `client/src/mapschema.ts` que o jogo usa para
carregar — então **não dá para exportar um mapa que o cliente rejeita**. Um
teste no servidor importa esse mesmo validador e confirma que o `map.json`
distribuído passa por ele (fonte única de verdade, referenciada dos dois lados).

## Pronto para pixel art (Etapa 8), sem renderizar sprite agora

O schema tem `tileStyles`: por tipo de tile, `{ color?, sprite? }`. A `color` já
é usada (render sólido, como hoje); `sprite` fica **reservado** — o editor o
exporta como `null`, o arquivo o carrega e preserva, mas nada desenha sprite
ainda. Adicionar pixel art depois é incremental (ler `sprite` no renderer), não
uma reescrita do editor nem do formato.

## Limitações conhecidas (honestas)

- **Sem undo/redo.** Pintou errado, pinta por cima. Aceitável para o protótipo.
- **Salas são retângulos** (como o modelo do jogo). Sem formatos livres.
- **Não salva no servidor:** exporta um arquivo que você troca à mão e reinicia
  o servidor — coerente com o "sem persistência" da spec. Um endpoint de upload
  seria o próximo passo se quiser editar ao vivo.
- **Cores fixas** na paleta padrão (o editor não tem seletor de cor por tipo
  ainda) — embora o schema já suporte cor por tile.
