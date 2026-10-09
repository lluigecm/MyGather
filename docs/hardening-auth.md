# Fase 2 · Item 4 — Autenticação (link com token)

Controle de acesso simples e suficiente para uso interno: um **token
compartilhado**. Sem cadastro, sem senha por usuário — quem tem o link entra.

## Como funciona

- Defina `AUTH_TOKEN` no servidor. Se estiver vazio/ausente, o acesso é **aberto**
  (comportamento de dev, e o que os testes existentes usam).
- Com `AUTH_TOKEN` definido, um middleware do Socket.io valida o token no
  handshake **antes** de aceitar a conexão. Comparação em tempo constante.
- O endpoint `/ice` (credenciais TURN) também passa a exigir o token.
- O cliente lê o token de `?token=…` na URL, guarda no `localStorage` (sobrevive
  a reloads) e **remove da barra de endereço** para não vazar no histórico.
- Token recusado → o cliente **para de tentar reconectar** e mostra
  "Acesso negado" (não fica num loop de retry).

## Uso

```bash
# gere um token forte
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

# rode o servidor com ele
AUTH_TOKEN=o_token_gerado npm --prefix server run dev

# compartilhe o link com a equipe
https://SEU_HOST:5173/?token=o_token_gerado
```

## Limitações conhecidas (honestas)

- **Token único para todos.** Não há identidade por pessoa nem revogação
  individual — para revogar, troca-se o token e redistribui-se o link. Suficiente
  para uma equipe pequena e de confiança; não para acesso público.
- **`/health` continua aberto.** É diagnóstico, mas expõe nomes e posições dos
  jogadores conectados. Se isso for sensível no seu caso, convém protegê-lo
  junto (ou removê-lo em produção).
- **O token trafega no link.** Mitigado por HTTPS (item 3) e pela limpeza da
  query no cliente, mas quem recebe o link tem acesso pleno — trate-o como senha.
- Sem **rate limiting** nas tentativas de conexão ainda — é o item 5 (próximo).
