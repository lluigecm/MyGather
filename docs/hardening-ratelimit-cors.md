# Fase 2 · Item 5 — Rate limiting + CORS restrito

Protege o servidor contra abuso (floods, brute-force de token) e restringe
quem pode conectar à origem real.

## Rate limiting (token bucket)

Cada limite recarrega a uma taxa por segundo, saturando numa capacidade (burst).
Ação sem ficha é **descartada** (não derruba a conexão — evita punir jitter).

| Alvo | Padrão | Onde | Sobre abuso |
|---|---|---|---|
| Conexões por IP | 5/s, burst 40 | middleware do handshake | contém brute-force de token |
| `move` por socket | 30/s, burst 45 | cliente envia ~20/s | flood de posição |
| `chat` por socket | 2/s, burst 5 | — | spam |
| `signal` por socket | 40/s, burst 80 | ICE trickle é chatty | flood de signaling |

Descartes são contabilizados em `/health` (`rateLimited`). Baldes por socket
vivem no escopo da conexão (somem ao desconectar); o de conexões-por-IP tem
limpeza periódica.

Configurável via env: `RL_CONN_RATE`, `RL_CONN_BURST`, `RL_MOVE_RATE`,
`RL_CHAT_RATE`, `RL_SIGNAL_RATE`.

## CORS restrito

- `ALLOWED_ORIGINS` (lista por vírgula) restringe as origens no Socket.io **e**
  nos endpoints HTTP. Vazio = libera geral (dev).
- Em produção, aponte para a origem real do cliente, ex.:
  `ALLOWED_ORIGINS=https://sala.empresa.com:5173`.

## Limitações conhecidas (honestas)

- **NAT compartilhado:** o limite de conexões é por IP. Um escritório inteiro
  atrás de um NAT divide o mesmo balde. Os padrões (burst 40) foram escolhidos
  para acomodar isso, mas uma equipe muito grande num único IP pode precisar de
  valores maiores. Não há distinção por usuário (não há identidade — ver item 4).
- **IP atrás de proxy reverso:** `socket.handshake.address` vê o IP do proxy,
  não o do cliente. Com um proxy na frente, seria preciso confiar em
  `X-Forwarded-For` — fora do escopo deste protótipo.
- **CORS não é autenticação:** protege o navegador de outras origens, mas um
  cliente não-navegador (script) ignora CORS. A proteção real de acesso é o
  token (item 4); o rate limiting de conexões é a defesa contra brute-force.
- Os descartes de `chat`/`move` são silenciosos para o remetente (só contam no
  `/health`). Para o protótipo é suficiente; um aviso "você está enviando rápido
  demais" seria um polimento futuro.
