# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /src/web-app
COPY web-app/package.json web-app/package-lock.json ./
RUN npm ci
COPY web-app/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/web-app/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
