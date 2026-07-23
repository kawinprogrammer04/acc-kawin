# ── Stage 1: Node builder ─────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Cache deps layer separately
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Build app (tsc may fail without tsconfig strict; skip type check in CI via vite only)
COPY . .
RUN npm run build

# ── Stage 2: Nginx runtime ────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default site
RUN rm /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config is mounted via volume or copied at deploy time
# (docker-compose mounts ./nginx/conf.d → /etc/nginx/conf.d)

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
