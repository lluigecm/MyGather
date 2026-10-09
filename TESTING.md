# Testes

Suíte de regressão versionada (Fase 2, item 2). Cobre as Etapas 1–7 e a
validação de movimento do servidor. Usa o **test runner nativo do Node**
(`node --test`) via `tsx` — sem framework adicional.

## Rodar tudo

```bash
npm test              # na raiz: servidor + cliente
npm run typecheck     # tsc --noEmit nos dois projetos
```

Ou por projeto:

```bash
npm run test:server   # unitários + paridade + integração
npm run test:client   # unitários (pathfinding, colisão)
```

Dentro de `server/`, dá para separar:

```bash
npm run test:unit          # rápido, sem servidor
npm run test:integration   # sobe o servidor real em porta livre
```

## O que cada suíte cobre

### `client/test/` (unitário, sem rede)
- **pathfinding** — A\* (Etapa 1): menor caminho, sem diagonais, contorno de
  parede, destino bloqueado/isolado → `null`, e o mapa real (passagem da sala).
- **collision** — `moveWithCollision` (Etapa 1): encostar sem invadir, deslizar
  por eixo, tiles sólidos e limites do mapa.

### `server/test/unit/` (unitário, sem rede)
- **movement** — validação de velocidade (teto, rajada, recarga do orçamento) e
  colisão no servidor (Fase 2).
- **rooms** — proximidade com histerese (Etapa 3) e precedência de salas
  (Etapa 5), incluindo `roomIdAtWorld` no mapa real.

### `server/test/collision-parity.test.ts`
Cruza `client/src/collision.ts` e `server/src/movement.ts`: onde o cliente para
ao empurrar contra uma parede tem de ser exatamente a última posição que o
servidor considera livre. Pega divergência de convenção de borda (`+ w - 1`)
entre os dois automaticamente.

### `server/test/integration/` (sobe o servidor real)
Clientes Socket.io que **caminham legalmente** (A\* + passos curtos), pois o
servidor agora valida velocidade/colisão.
- **proximity** — ids únicos, spawn autoritativo, conectar/desconectar por
  distância, remoção na saída (Etapas 2–3).
- **rooms** — isolamento da sala e conexão dentro dela (Etapa 5).
- **chat** — entrega por alcance/sala, trim/truncamento (Etapa 6).
- **forgery** — o cenário motivador da Fase 2: cliente forjado (socket cru)
  tentando entrar na sala por handshake, teleporte e rajada — todos bloqueados;
  entrada legítima pela porta funciona.

## Fora desta suíte (limitação conhecida)

Os testes de **navegador** (Playwright) usados para validar renderização de
canvas, áudio WebRTC real e autoplay durante as Etapas 4 e 7 **não** foram
versionados aqui — dependem de Chromium e dispositivos de mídia falsos. Rodar
`node --test` os cobre no nível de lógica/protocolo, mas a camada visual/`<audio>`
continua verificada apenas manualmente. Portá-los para CI com Playwright é um
próximo passo recomendado.
