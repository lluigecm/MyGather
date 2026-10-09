# Fase 2 · Item 7 — Reconexão preservando identidade de sessão

Ao cair a conexão e reconectar (com um novo `socket.id`), o jogador retoma a
**mesma posição, nome e estado de mudo** — em vez de reaparecer no spawn como
um jogador novo.

## Como funciona

- O cliente gera um `sessionId` aleatório (UUID) uma vez e guarda no
  `localStorage`. Ele vai no handshake (`auth.sessionId`) em toda (re)conexão.
- Ao **desconectar**, o servidor guarda o último estado autoritativo daquele
  `sessionId` (posição já validada, nome, mudo) por uma janela de carência
  (`SESSION_GRACE_MS`, padrão 60s).
- Ao **reconectar** dentro da janela, o servidor restaura esse estado. A
  posição vem do que **o servidor guardou** — o cliente nunca a envia.

## Por que isto NÃO reabre o furo do item 1

O item 1 fechou o furo de "posição forjada no handshake". Aqui a posição
restaurada é a **última que o servidor validou** para aquela sessão; o cliente
só fornece o `sessionId` (a chave), nunca coordenadas. Há um teste que prova
isso: um cliente que tenta teleportar para dentro da sala (rejeitado pelo item 1),
ao religar, volta **fora** da sala — a posição forjada nunca foi aceita, então
nunca foi salva.

## `sessionId` × autenticação (item 4)

São coisas diferentes, de propósito:

- **Autenticação** = token compartilhado (item 4): decide *se* você entra.
- **`sessionId`** = identidade de reconexão: decide *a qual estado anterior*
  você religa. **Não** autentica.

Como o token é o mesmo para todos, ele não distingue "a mesma pessoa" voltando —
daí a necessidade do `sessionId` separado, gerado e guardado pelo cliente.

## Limitações conhecidas (honestas)

- **Sequestro de sessão:** quem soubesse o `sessionId` de alguém poderia religar
  ao estado dela — inclusive a uma posição **dentro de uma sala fechada**, se a
  vítima caiu lá dentro. Mitigações: o `sessionId` é um UUID de 122 bits
  (inadivinhável), a janela é curta (60s) e ele nunca é exposto a outros
  clientes. É **muito** mais difícil que o furo original (trivial). Uma defesa
  mais forte viria de amarrar a sessão a uma identidade por usuário — o que só
  faz sentido quando a autenticação deixar de ser um token único (evolução
  futura do item 4).
- **Estado em memória:** se o **servidor** reiniciar, todas as sessões salvas
  se perdem (coerente com a decisão de "sem persistência" da spec). A retomada
  funciona para quedas de **conexão** com o servidor no ar, não para restart do
  servidor.
- **Duas abas com o mesmo `localStorage`** compartilham o `sessionId`; ao cair
  uma, a outra pode acabar herdando o último estado salvo. Aceitável para o
  protótipo; uma identidade por aba resolveria.
- **Flicker para os outros:** durante a queda, os demais veem a pessoa sair
  (`player:left`) e voltar (`player:joined`) na posição restaurada. Manter um
  "fantasma" visível durante a carência seria um polimento futuro.
