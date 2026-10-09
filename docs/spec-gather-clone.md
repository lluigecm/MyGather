# Especificação Técnica — Gather Clone (Protótipo)

## 1. Contexto e Objetivo

Construir uma versão própria e simplificada do Gather Town: um espaço virtual 2D onde usuários controlam avatares que se movem por um mapa, com áudio/vídeo ativado automaticamente por proximidade entre avatares.

O produto final deve suportar uso real por uma equipe pequena (poucas dezenas de pessoas simultâneas), não é apenas um exercício de aprendizado.

## 2. Escopo Geral (todas as etapas)

**Entra no protótipo completo:**
- Mapa 2D com colisão
- Movimento de avatar em tempo real, multiplayer
- Áudio/vídeo por proximidade (WebRTC mesh, peer-to-peer)
- Salas fechadas (zonas de áudio compartilhado, ignorando proximidade)
- Chat de texto
- Reconexão automática em caso de queda

**NÃO entra nesta fase (fora de escopo):**
- Editor visual de mapas (mapas serão definidos via arquivo/config, não por UI)
- Autenticação robusta (login simples ou nenhum, a definir depois)
- Gravação de sessões
- Compartilhamento de tela
- Mobile / responsividade
- Persistência de mensagens de chat (chat é efêmero, apenas em memória durante a sessão)

## 3. Arquitetura

```
Cliente (Canvas + TypeScript)          Servidor (Node.js + Socket.io)
┌───────────────────────┐              ┌──────────────────────────┐
│ Renderiza mapa e avatares│◄──────────►│ Sincroniza posições         │
│ Captura input (setas)    │  socket.io  │ Detecta proximidade         │
│ Detecta colisão local     │            │ Faz signaling WebRTC        │
│ Gerencia peers WebRTC     │◄───P2P────►│ (não intermedia áudio/vídeo)│
│ Exibe chat                │            │ Retransmite chat             │
└───────────────────────┘              └──────────────────────────┘
```

**Decisões técnicas já tomadas (não renegociar sem justificativa forte):**
- Frontend: TypeScript puro + HTML5 Canvas (sem framework de UI tipo Angular/React/Vue)
- Backend: Node.js + Express + Socket.io
- WebRTC: `simple-peer`, topologia **mesh** (P2P direto entre clientes, sem SFU/servidor de mídia)
- Mapas: definidos em arquivo JSON estático (tilemap), carregado pelo cliente
- Sem banco de dados nesta fase — estado vive em memória no servidor (perde-se ao reiniciar)

## 4. Estrutura de Pastas Esperada

```
/server
  /src
    index.ts          # entrypoint Express + Socket.io
    rooms.ts           # lógica de salas e proximidade
    types.ts           # tipos compartilhados (Player, Position, etc)
/client
  /src
    main.ts            # entrypoint, game loop
    canvas.ts           # renderização
    player.ts           # lógica de avatar e input
    collision.ts        # detecção de colisão com o mapa
    network.ts          # cliente Socket.io
    webrtc.ts            # gerenciamento de peers WebRTC
    map.json             # tilemap de exemplo
/docs
  spec-gather-clone.md   # este documento
```

## 5. Etapas e Critérios de Aceite

### Etapa 1 — Mapa + Movimento (foco atual)

**Objetivo:** um único jogador se move por um mapa 2D com colisão, sem multiplayer ainda.

**Critérios de aceite:**
- [ ] Mapa é carregado a partir de um arquivo `map.json` contendo uma grade de tiles (cada tile com tipo: `floor`, `wall`, `object`)
- [ ] Avatar é renderizado como um retângulo/sprite simples no Canvas
- [x] ~~Avatar se move com as setas do teclado~~ **[REVISADO — ver 5.1]** Avatar se move por clique do mouse, seguindo o menor caminho até o ponto clicado, em movimento suave (não por tile inteiro)
- [ ] Avatar **não atravessa** tiles do tipo `wall` ou `object` (colisão AABB simples)
- [ ] Câmera segue o avatar quando o mapa é maior que a viewport
- [ ] Game loop roda a 60fps usando `requestAnimationFrame`

**Fora de escopo nesta etapa:** rede, múltiplos jogadores, áudio, chat.

### 5.1 — Revisão: Movimentação por Clique (Point-and-Click com Pathfinding)

**Motivo da revisão:** controle por teclado (setas) substituído por clique do mouse, mais alinhado à UX do Gather original em telas menores e mais natural para movimentação de longa distância no mapa.

**Mudança de critério 3 (Etapa 1):**
- ~~Movimento com setas do teclado~~ → Movimento por clique do mouse com pathfinding

**Decisões técnicas da revisão:**
- **Algoritmo:** A* sobre a grade de tiles do mapa (`tiles` do `map.json`), tratando `floor` como nó livre e `wall`/`object` como nó bloqueado
- **Movimento:** 4 direções (cima/baixo/esquerda/direita) para o cálculo do caminho — sem diagonais no grafo de pathfinding, para simplificar (revisitar se ficar visualmente ruim)
- **Interação:** clique esquerdo do mouse em um tile `floor` calcula o caminho e move o avatar suavemente ao longo dos waypoints, na mesma velocidade (px/segundo) já usada
- **Clique em tile bloqueado (`wall`/`object`):** ignorado, sem erro visual necessário nesta fase (pode virar feedback visual em polimento futuro)
- **Clique durante movimento em andamento:** cancela o caminho atual e recalcula para o novo destino
- **Sem caminho possível** (destino isolado): não faz nada (sem crash, sem movimento)

**Critérios de aceite adicionais desta revisão:**
- [ ] Clique em tile `floor` navegável calcula o menor caminho via A* e move o avatar suavemente até o destino
- [ ] Avatar segue os waypoints do caminho sem atravessar `wall`/`object` em nenhum ponto do trajeto
- [ ] Clique em tile bloqueado não move o avatar nem quebra a aplicação
- [ ] Novo clique durante um movimento em andamento cancela o caminho anterior e recalcula
- [ ] Controle por teclado (setas) é removido do código

### Etapa 2 — Multiplayer básico

**Critérios de aceite:**
- [ ] Servidor Socket.io aceita conexões e atribui um ID único por jogador
- [ ] Cliente envia sua posição ao servidor a cada frame (ou via throttle, ex: 20x/segundo)
- [ ] Servidor retransmite posições de todos os jogadores para todos os clientes conectados
- [ ] Cada cliente renderiza os avatares dos outros jogadores na posição recebida
- [ ] Jogador que desconecta é removido da tela de todos os outros

### Etapa 3 — Detecção de Proximidade

**Critérios de aceite:**
- [ ] Servidor calcula distância euclidiana entre todos os pares de jogadores a cada tick
- [ ] Ao ficar com distância ≤ X pixels (valor configurável, ex: 150px), servidor emite evento `peer:enter` para os dois jogadores envolvidos
- [ ] Ao ultrapassar a distância, servidor emite evento `peer:leave`
- [ ] Eventos não devem "piscar" (usar uma pequena margem de histerese entre entrar/sair para evitar oscilação na borda)

### Etapa 4 — Áudio/Vídeo por Proximidade (WebRTC)

**Critérios de aceite:**
- [ ] Ao receber `peer:enter`, cliente inicia handshake WebRTC via `simple-peer`, usando o servidor Socket.io como canal de signaling
- [ ] Conexão P2P estabelece stream de áudio (vídeo opcional/toggle)
- [ ] Ao receber `peer:leave`, conexão WebRTC correspondente é encerrada e stream removido
- [ ] Suporta múltiplas conexões simultâneas (um jogador pode estar em alcance de 2+ pessoas ao mesmo tempo)
- [ ] Falha de conexão WebRTC não trava o cliente (fallback: log de erro, tenta reconectar)

### Etapa 5 — Salas Fechadas

**Critérios de aceite:**
- [ ] Zonas especiais no `map.json` marcadas como `room` com um `roomId`
- [ ] Jogadores dentro da mesma `room` conectam entre si via WebRTC independentemente da distância de proximidade
- [ ] Jogadores dentro de uma `room` NÃO ouvem jogadores fora dela, mesmo que estejam fisicamente próximos (ex: do lado de fora de uma parede da sala)

### Etapa 6 — Chat de Texto

**Critérios de aceite:**
- [ ] Campo de input de texto na UI, envio via Enter
- [ ] Mensagem é retransmitida via Socket.io para jogadores em alcance (mesma lógica de proximidade/sala do áudio) ou, na versão mais simples, para todos
- [ ] Mensagens aparecem numa área de chat lateral ou como balão acima do avatar

### Etapa 7 — Polimento

**Critérios de aceite:**
- [ ] Nome do jogador exibido acima do avatar
- [ ] Indicador visual de "falando" (ex: borda colorida) quando o microfone detecta volume acima de um limiar
- [ ] Reconexão automática de Socket.io em caso de queda de rede

## 6. Riscos e Dúvidas em Aberto

- **Escalabilidade do mesh WebRTC:** topologia mesh degrada com muitas conexões simultâneas no mesmo ponto do mapa (cada cliente abre N conexões P2P). Aceitável para equipe pequena; se crescer, avaliar migração para SFU (ex: mediasoup, LiveKit).
- **Autenticação:** decidir antes da etapa 2 se haverá algum controle de acesso (ex: link com token) ou se será acesso aberto.
- **Formato do mapa:** validar se JSON manual é suficiente ou se compensa usar um editor existente (ex: Tiled) exportando para JSON compatível.

## 7. Fase 2 — Hardening (pós-protótipo)

As 7 etapas originais foram concluídas e validadas. Esta fase resolve as limitações conhecidas antes de uso real com a equipe, na seguinte ordem:

1. **Validação de movimento no servidor** — limite de velocidade máxima por tick e checagem de colisão/paredes no servidor (não confiar só no cliente). Crítico porque, sem isso, o isolamento das Salas Fechadas (Etapa 5) pode ser burlado por um cliente modificado — deixou de ser cosmético e virou questão de privacidade.
2. **Testes versionados no repositório** — portar os scripts de validação (unitários + integração) para `server/test` e `client/test`, cobrindo pelo menos as regressões já usadas nas Etapas 1–7.
3. **TURN server + HTTPS** — resolve conexões atrás de NAT simétrico/firewall corporativo (bloqueante para uso real) e é pré-requisito de `getUserMedia` fora de localhost. TURN (coturn) foi implementado e as credenciais efêmeras foram validadas, mas o relay real entre redes diferentes **não foi testado** — decisão consciente, já que a equipe de uso não se conecta via 4G/rede corporativa restritiva. Risco aceito: se algum dia alguém entrar de uma rede com NAT simétrico/firewall pesado, o P2P pode falhar sem aviso claro (sintoma: "não ouço fulano"). HTTPS/WSS seguem validados e em uso.
4. **Autenticação simples** — link com token compartilhado é suficiente para uso interno.
5. **Rate limiting + CORS restrito** — proteger `move`, `chat`, `signal` e conexões contra abuso; restringir `cors.origin` à origem real.
6. **Melhorias de produto (sem ordem definida):** reconexão preservando identidade de sessão, toggle de vídeo, mudo/push-to-talk, editor de mapas ou import do Tiled.

## 8. Etapa 8 — Arte Pixelada

**Objetivo:** substituir os placeholders visuais (retângulos coloridos) por sprites pixel art reais, tanto para avatares quanto para tiles do mapa.

**Fontes de arte definidas:**
- **Personagens:** [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/) — licença CC-BY-SA 3.0 (exige atribuição, arquivo `CREDITS.txt` no repo). Gerar 4-6 combinações fixas (não é customização livre nesta etapa), cada uma com spritesheet de walk nas 4 direções.
- **Tiles do mapa:** [Pixel Cyberpunk Interior](https://livingtheindie.itch.io/pixel-cyberpunk-interior) (itch.io, DyLESTorm) — tileset 32×32, uso comercial/não-comercial livre, crédito apreciado mas não obrigatório, não pode ser revendido/redistribuído separadamente. Tema visual mudou de "escritório" para "cyberpunk/futurista". Atenção: há relatos de offset de 1px no tile da porta — validar visualmente antes de finalizar.

**Critérios de aceite:**

*Personagens:*
- [ ] 4-6 spritesheets de personagem baixados, licenciados e versionados no repo, com `CREDITS.txt` atualizado
- [ ] Sistema de parsing de spritesheet (linhas/colunas → frames por direção)
- [ ] Avatar anima entre frames de "walk" enquanto se move, e frame parado ("idle") quando parado
- [ ] Direção do sprite reflete a direção do movimento atual (N/S/L/O)
- [ ] Tela de seleção de personagem (uma das 4-6 opções) antes de entrar no mapa, ou como configuração persistida
- [ ] Escolha do personagem é sincronizada — outros jogadores veem o sprite correto de cada um, não só o próprio jogador

*Tiles do mapa:*
- [ ] Pacote de tileset Kenney (ou similar CC0) integrado, mapeado para os tipos `floor`/`wall`/`object` via `tileStyles.sprite`
- [ ] Renderização usa a imagem quando `tileStyles.sprite` está definido; mantém fallback de cor sólida quando não está (compatibilidade com mapas antigos/editor)
- [ ] Editor de mapas (client/editor.html) também reflete a arte real, não só cor

**Convenções de montagem do mapa (tileset Pixel Cyberpunk Interior):**

O tileset pressupõe uma perspectiva top-down 2.5D. A montagem do `map.json` deve
seguir estas convenções (validadas contra a imagem promocional do pacote em
`client/src/assets/reference.png`):

- **Fundo escuro / moldura.** O mapa é majoritariamente `wall` (o "vazio" sólido,
  renderizado como um fundo escuro), com as salas *escavadas* como `floor` e
  conectadas por portas/corredores. Isso dá silhueta/moldura ao conjunto em vez
  de bordas abertas. A colisão continua vindo da grade `tiles`.
- **Parede com altura (2 fileiras).** Toda parede que faz fronteira com `floor`
  ao SUL (parede "voltada para a câmera") renderiza como duas fileiras: um
  **cap/topo escuro** na fileira de cima + a **face com friso** (sprite `2,0`:
  friso laranja no topo + face cinza) na fileira de baixo, com o piso começando
  logo abaixo. As demais paredes (laterais, inferiores, interiores do vazio)
  são apenas o fundo escuro. A coluna 3 do sheet (transição diagonal) não é usada.
- **Friso só na parede.** As barras laranja/branco são friso de parede — só podem
  aparecer na face de parede, nunca soltas como objeto de chão.
- **Decals de parede.** Monitores, letreiros neon, painéis e telas são montados
  NA face da parede, não no chão. O `map.json` tem uma lista `decals` de
  `{ x, y, sprite }` desenhada por cima da face da parede; é puramente visual
  (não altera colisão — a parede já é sólida). Distinta de `decor` (móveis de chão).
- **Objetos = piso + móvel.** Todo `object` renderiza o `floor` por baixo e o móvel
  por cima (sempre sólido). Itens pequenos (monitor, xícara) só existem compostos
  sobre uma mesa/console — nunca soltos no piso.
- **Salas pequenas e densas.** Preferir 3-4 cômodos de ~8×6 conectados por portas/
  corredor, com mobília encostada nas paredes e pouco piso livre, em vez de um
  salão único grande e vazio.
- **Grade.** A grade de tiles é overlay do EDITOR apenas; nunca aparece no jogo.

**Fora de escopo nesta etapa:** customização livre de avatar (cor por atributo), animações além de walk/idle (ex: emotes), parallax ou decoração ambiental além dos tiles.

---
*Este documento serve como referência de escopo e critérios de aceite para implementação assistida (ex: Claude Code). Alterações de escopo devem ser refletidas aqui antes de seguir para a próxima etapa.*
