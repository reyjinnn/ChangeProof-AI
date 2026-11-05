# Disposable local stack image (dev/try-out only, never production).
# Pinned to the repo's runtimes (node 26.12.1, pnpm 12.5.1).
FROM node:26.12.1-slim

RUN npm install -g pnpm@12.5.1

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm build:ui
RUN mkdir -p /data/evidence

ENV PORT=4179 \
  CP_MANIFEST=/app/config/publicsite/manifest.json \
  CP_DIST=/app/apps/dashboard/dist \
  CP_EVIDENCE_DIR=/data/evidence

EXPOSE 4179
CMD ["node", "dist/http/start.js"]
