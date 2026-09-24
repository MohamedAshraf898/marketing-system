# Famolya - production image (used by Railway, Fly.io, any Docker host)
FROM node:22-bookworm-slim

# openssl + CA certs are needed by Prisma (migrations) and outbound HTTPS
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) dependencies first (better layer caching). Dev deps are needed: the server runs with tsx.
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --ignore-scripts

# 2) source, Prisma client, and the web build
COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
# Data lives on a mounted volume (/data) so it survives redeploys.
ENV DATABASE_URL=file:/data/og-system.db \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/data/backups \
    COOKIE_SECURE=true \
    TRUST_PROXY=1

EXPOSE 4000
CMD ["sh", "scripts/start-prod.sh"]
