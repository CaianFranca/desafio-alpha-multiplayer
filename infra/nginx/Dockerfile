FROM node:22-bookworm AS build
WORKDIR /app
COPY packages/shared ./packages/shared
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
WORKDIR /app/frontend
RUN npm run build

FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/default.conf
# Snippets incluídos por nginx.conf (include absoluto): extensão .snippet
# para NÃO serem auto-carregados pelo `include conf.d/*.conf` da imagem.
COPY infra/nginx/hsts-map.snippet /etc/nginx/conf.d/hsts-map.snippet
COPY infra/nginx/security-headers.snippet /etc/nginx/conf.d/security-headers.snippet
COPY infra/nginx/security-headers-static.snippet /etc/nginx/conf.d/security-headers-static.snippet
COPY --from=build /app/frontend/dist /usr/share/nginx/html
