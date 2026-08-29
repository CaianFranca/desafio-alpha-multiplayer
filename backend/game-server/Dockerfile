FROM node:24-alpine

WORKDIR /app

# Copia manifests para cache de deps (contexto = raiz do monorepo)
COPY package.json package-lock.json* ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY backend/lobby-server/package.json ./backend/lobby-server/package.json
COPY backend/game-server/package.json ./backend/game-server/package.json

RUN npm ci

# Copia código necessário para dev (bind-mount sobrescreve no compose)
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/engine ./packages/engine
COPY backend/game-server ./backend/game-server

WORKDIR /app/backend/game-server

ARG GAME_SERVER_PORT=1234
EXPOSE ${GAME_SERVER_PORT}

CMD ["npm", "run", "dev"]
