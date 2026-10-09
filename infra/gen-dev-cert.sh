#!/usr/bin/env bash
# Gera um certificado self-signed para DESENVOLVIMENTO (Fase 2, item 3).
# getUserMedia exige contexto seguro fora de localhost — este cert permite
# rodar client e server em HTTPS/WSS numa LAN.
#
# Uso:   infra/gen-dev-cert.sh [host-ou-ip ...]
# Ex.:   infra/gen-dev-cert.sh 192.168.1.20 meu-note.local
#
# Em produção use certificados de verdade (Let's Encrypt) ou, para redes
# internas com dispositivos que você controla, o mkcert (CA confiável local).
set -euo pipefail

OUT_DIR="$(cd "$(dirname "$0")" && pwd)/certs"
mkdir -p "$OUT_DIR"

# SAN: sempre localhost + 127.0.0.1, mais os hosts/IPs passados como argumento.
SAN="DNS:localhost,IP:127.0.0.1"
i=1
for h in "$@"; do
  if [[ "$h" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SAN="$SAN,IP:$h"
  else
    SAN="$SAN,DNS:$h"
  fi
  i=$((i + 1))
done

echo "Gerando cert com SAN: $SAN"
# MSYS_NO_PATHCONV evita que o Git Bash (Windows) converta "/CN=..." num caminho.
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$OUT_DIR/key.pem" \
  -out "$OUT_DIR/cert.pem" \
  -days 365 \
  -subj "/CN=mygather-dev" \
  -addext "subjectAltName=$SAN"

echo
echo "Certificado gerado em: $OUT_DIR"
echo "  cert: $OUT_DIR/cert.pem"
echo "  key:  $OUT_DIR/key.pem"
echo
echo "Rode server e client apontando para eles, ex.:"
echo "  TLS_CERT=$OUT_DIR/cert.pem TLS_KEY=$OUT_DIR/key.pem npm --prefix server run dev"
echo "  TLS_CERT=$OUT_DIR/cert.pem TLS_KEY=$OUT_DIR/key.pem npm --prefix client run dev"
