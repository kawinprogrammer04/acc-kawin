#!/bin/sh
# ── Generate a self-signed TLS certificate for development ────────────────────
# Run once before first `docker compose up`.
# For production replace with real certs or use Let's Encrypt (see Makefile).
set -e

SSL_DIR="$(dirname "$0")/../nginx/ssl"
DOMAIN="${1:-accounting.internal}"

mkdir -p "$SSL_DIR"

echo "Generating self-signed cert for domain: ${DOMAIN}"

openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout "${SSL_DIR}/privkey.pem" \
  -out    "${SSL_DIR}/fullchain.pem" \
  -subj   "/C=TH/ST=Bangkok/L=Bangkok/O=Accounting System/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1"

# DH params (takes ~30 seconds)
if [ ! -f "${SSL_DIR}/dhparam.pem" ]; then
  echo "Generating DH params (this takes a moment)..."
  openssl dhparam -out "${SSL_DIR}/dhparam.pem" 2048
fi

echo ""
echo "✓ Certificates created in ${SSL_DIR}/"
echo "  fullchain.pem  — certificate"
echo "  privkey.pem    — private key"
echo "  dhparam.pem    — DH parameters"
echo ""
echo "Add '${DOMAIN}' to /etc/hosts on client machines:"
echo "  echo '127.0.0.1  ${DOMAIN}' | sudo tee -a /etc/hosts"
