# Fase 2 · Item 3 — TURN + HTTPS

Resolve dois problemas de uso real com a equipe:

1. **NAT/firewall:** o mesh WebRTC (P2P direto) falha quando os pares estão
   atrás de NAT simétrico ou firewall corporativo. Um servidor **TURN** faz o
   relay do áudio nesses casos.
2. **Contexto seguro:** `getUserMedia` (microfone) só funciona em HTTPS fora de
   `localhost`. Então, para testar/rodar na LAN, client e server precisam de
   **HTTPS/WSS**.

Objetivo aqui é protótipo para equipe pequena — TURN auto-hospedado (coturn) e
cert self-signed/mkcert, não uma configuração de produção elaborada.

> **Status: TURN implementado mas NÃO implantado (decisão de escopo).**
> STUN + P2P direto deve cobrir o time atual — não se esperam colegas em
> 4G/CGNAT nem em rede corporativa fechada, que são os casos que exigem relay.
> O TURN fica como um **interruptor pronto**: se um colega específico reportar
> que não consegue ser ouvido pelos outros, liga-se sob demanda preenchendo
> `TURN_URLS`/`TURN_SECRET` no `.env` (nada precisa ser reescrito — o ICE já
> usa o TURN só como fallback do direto). Não é uma garantia de que funciona em
> qualquer rede; é uma capacidade pronta para ativar quando/se for preciso.

## Como funciona o TURN aqui

- O servidor Node gera **credenciais efêmeras** (HMAC-SHA1) no formato REST API
  do coturn e as envia ao cliente no evento `welcome` (renovadas a cada
  conexão). Nenhuma senha de longa duração vai para o bundle do cliente.
- O cliente passa esses `iceServers` ao `simple-peer` (`config.iceServers`).
- O coturn valida a mesma HMAC usando o `static-auth-secret`, que **precisa ser
  igual** ao `TURN_SECRET` do servidor Node.

## 1. Subir o coturn

```bash
# instale o coturn (ex.: apt install coturn / brew install coturn)
# edite infra/turnserver.conf: troque static-auth-secret e ajuste external-ip
turnserver -c infra/turnserver.conf
```

## 2. Configurar o servidor Node

```bash
cp server/.env.example server/.env    # edite os valores
# TURN_URLS, TURN_SECRET (== static-auth-secret do coturn), STUN_URLS
```

Confira as credenciais sendo geradas:

```bash
curl http://localhost:3000/ice
# -> { "iceServers": [ {stun...}, {urls:[turn...], username, credential} ] }
```

## 3. HTTPS na LAN (para o microfone funcionar)

```bash
# gere um cert de dev cobrindo localhost + o IP da sua máquina na LAN
infra/gen-dev-cert.sh 192.168.1.20

# suba os dois em HTTPS apontando para o cert gerado
TLS_CERT=infra/certs/cert.pem TLS_KEY=infra/certs/key.pem npm --prefix server run dev
TLS_CERT=infra/certs/cert.pem TLS_KEY=infra/certs/key.pem npm --prefix client run dev
```

Acesse `https://192.168.1.20:5173` de outra máquina. Como o cert é self-signed,
o navegador vai pedir para aceitar o risco (uma vez por dispositivo). Para
evitar esse aviso em redes que você controla, use **mkcert** (instala uma CA
local confiável) no lugar do `gen-dev-cert.sh`.

O cliente deriva a URL do servidor da origem da página (mesmo host, porta 3000,
mesmo protocolo), então `https://…:5173` conecta em `wss://…:3000`
automaticamente. Sobrescreva com `VITE_SERVER_URL` se necessário.

## Diagnóstico: `?forceRelay=1`

Abrir o app com `?forceRelay=1` passa `iceTransportPolicy: 'relay'` ao WebRTC —
**proíbe o P2P direto**. Se dois clientes conectarem e o áudio funcionar nesse
modo, a mídia obrigatoriamente passou pelo TURN. É o jeito mais barato de
validar o TURN sem precisar de duas redes: sobe o coturn, abre dois navegadores
(mesmo na mesma rede) com `?forceRelay=1` e confirma o áudio.

## Validado localmente contra coturn REAL

Rodamos um coturn 4.6.1 de verdade (via WSL) e comprovamos, headless:

- Um `RTCPeerConnection` obteve candidato **`typ relay`** autenticando com a
  **credencial efêmera HMAC gerada pelo nosso `ice.ts`** — o log do coturn
  mostrou `ALLOCATE processed, success` para aquele username. Ou seja: o binário
  real do coturn **aceita** nossas credenciais (antes isso só era testado contra
  o algoritmo documentado).
- Dois peers do app com `?forceRelay=1` conectaram e trocaram **áudio nos dois
  sentidos** com o P2P direto proibido → mídia relaiada pelo coturn.

## Estado e limitação (honesta)

**Validado:** geração de credenciais efêmeras (aceitas por coturn real),
plumbing HTTPS/WSS, entrega dos `iceServers`, e **relay de mídia de fato** (via
`?forceRelay=1` contra coturn local). A mecânica do TURN funciona.

**Não implantado, por decisão de escopo.** O time atual não tem colegas
esperados em 4G/CGNAT nem em rede corporativa fechada — os casos que exigem
relay. Para banda larga residencial comum, o **STUN + P2P direto** deve cobrir
todo mundo, e a degradação é suave (quem não conecta apenas não conecta, sem
travar os outros). Então o TURN fica **pronto mas desligado**.

**O que NÃO foi verificado** (e por ora não será): o cenário de **NAT simétrico
entre duas redes diferentes** de verdade — o único que prova que o relay é
*necessário e suficiente* num deploy real (inclui a config do servidor:
`external-ip`, abertura de UDP e do range de portas de relay no firewall, que é
a causa nº 1 de TURN quebrado). Isso não é uma garantia; é o teste que se faz
**no dia em que** o interruptor for ligado.

**Ligar sob demanda:** se um colega específico reportar que não consegue ser
ouvido pelos outros, preencha `TURN_URLS`/`TURN_SECRET` no `.env` apontando para
um coturn público (ver acima). O ICE já usa o TURN só como fallback do direto,
então ativá-lo é aditivo — não muda nada para quem já conecta. Aí sim, faça o
teste cross-network (um colega no 4G/rede restritiva, o outro no Wi-Fi) para
confirmar contra o problema real.
