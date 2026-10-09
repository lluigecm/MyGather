# Fase 2 · Melhorias de produto — Toggle de vídeo

Vídeo é opcional (spec): um botão liga/desliga a câmera, **reaproveitando a
mesma conexão WebRTC já estabelecida para o áudio**.

## Como funciona

- Vídeo é **puramente P2P** sobre a conexão existente. Ligar a câmera faz
  `peer.addTrack(videoTrack)` em cada conexão já aberta; desligar faz
  `removeTrack`. Ambos disparam **renegociação de SDP na MESMA conexão** — não
  criam um peer novo e **não passam pelo servidor** (nenhuma mudança no servidor
  foi necessária).
- O áudio segue na mesma conexão, ininterrupto.
- Cada peer que liga a câmera vira um **tile de vídeo** na barra, rotulado com o
  nome. Ao desligar (ou o peer cair), o tile some.
- Sem câmera / permissão negada: o botão vira "🚫 Sem câmera" e a app segue
  normal (áudio e resto inalterados).

## Um bug real que o teste pegou

Ao ligar a câmera, o `simple-peer` reemite o evento `stream` com um stream **só
de vídeo**. O handler de áudio jogava esse stream no elemento `<audio>`,
**derrubando o áudio do peer**. Corrigido ignorando streams sem faixa de áudio
no handler de áudio (o vídeo é tratado pelo evento `track`). Sem o teste de
navegador que mede a energia do áudio após ligar o vídeo, isso passaria batido.

## Limitações conhecidas (honestas)

- **Mesh:** cada pessoa com câmera envia seu vídeo para cada peer em alcance. É
  bem mais pesado que áudio; para poucas pessoas próximas tudo bem, mas com
  muita gente na mesma aglomeração degrada rápido — o mesmo limite de mesh já
  conhecido (a migração para SFU resolveria).
- **Sem controle de resolução/bitrate** ainda: usa o padrão da câmera. Ajustar
  constraints (resolução baixa) reduziria a carga.
- Validado com a **câmera falsa** do Chromium (padrão sintético), não com uma
  webcam física. A cadeia (getUserMedia vídeo → addTrack → renegociação →
  `<video>` remoto) é a real.
