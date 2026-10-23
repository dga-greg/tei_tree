# Web image: the built Angular app served by nginx, which also proxies /api to the API.
#   docker build -f frontend/Dockerfile -t family-heritage-web .

# Behind a TLS-intercepting proxy, pass its CA certificate (kept out of the image):
#   docker build --secret id=ca,src=/path/to/ca.pem …
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca npm install -g npm@11 && npm cache clean --force
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca npm ci --workspace=@fh/contracts --workspace=frontend
COPY contracts contracts
COPY frontend frontend
RUN --mount=type=secret,id=ca,required=false export NODE_EXTRA_CA_CERTS=/run/secrets/ca && npm run build -w @fh/contracts && npm run build -w frontend

FROM nginxinc/nginx-unprivileged:1.27-alpine
# API_UPSTREAM: where the API listens. MEDIA_ORIGINS: object-storage origin(s) photos and recordings
# are served from (e.g. https://media.example.org), added to the Content-Security-Policy.
# MAP_TILE_ORIGINS: where map tiles come from (the origin of the API's MAP_TILE_URL), also allowed as images.
ENV API_UPSTREAM=http://api:3000 \
    MEDIA_ORIGINS="" \
    MAP_TILE_ORIGINS="" \
    MAX_UPLOAD_SIZE=60m
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
