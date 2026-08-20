FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY knexfile.ts tsconfig.json ./
COPY migrations ./migrations
COPY seeds ./seeds

ENTRYPOINT ["sh", "-c", "npx knex migrate:latest --knexfile knexfile.ts && npx knex seed:run --knexfile knexfile.ts"]
