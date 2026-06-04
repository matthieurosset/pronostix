# Pronostix — single-container image (API + static SPA + SQLite)
# Multi-stage: the builder has the toolchain for the native better-sqlite3 module
# (prebuilt binaries are used when available; compilation works as a fallback),
# the runtime stays slim.

FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/pronostix.sqlite

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# SQLite database lives on a mounted volume
VOLUME ["/data"]
EXPOSE 3000

# On boot: apply seed (idempotent), then start the server.
CMD ["sh", "-c", "node scripts/seed.js && node server/index.js"]
