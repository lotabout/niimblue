FROM node:25-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run sv-check && npm run build

# The Compose deployment uses this target for static files + HTTPS + API proxy.
FROM caddy:2-alpine AS https-server

COPY --from=builder /app/dist/ /srv/
COPY deploy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443

# Keep the existing HTTP-only image as the default target.
FROM nginx:1.27-alpine AS server

COPY --from=builder /app/dist/ /usr/share/nginx/html/

EXPOSE 80
