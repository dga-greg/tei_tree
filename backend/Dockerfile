# API and background worker image. Build from the repository root:
#   docker build -f backend/Dockerfile -t family-heritage-api .
# Run the API:    docker run … family-heritage-api
# Run the worker: docker run … family-heritage-api node backend/dist/worker.js

# Behind a TLS-intercepting proxy, pass its CA certificate (kept out of the image):
#   docker build --secret id=ca,src=/path/to/ca.pem …
FROM node:22-bookworm-slim AS build
WORKDIR /app
# npm 10's arborist crashes on this workspace layout; npm 11 installs it cleanly.
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca npm install -g npm@11 && npm cache clean --force
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca npm ci --workspace=@fh/contracts --workspace=backend
COPY contracts contracts
COPY backend backend
RUN npm run build -w @fh/contracts && npm run build -w backend

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca npm install -g npm@11 && npm cache clean --force
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca npm ci --omit=dev --workspace=@fh/contracts --workspace=backend && npm cache clean --force
COPY --from=build /app/contracts/dist contracts/dist
COPY --from=build /app/backend/dist backend/dist
# Fonts for the printable family book (SIL Open Font License, see OFL.txt).
COPY backend/assets backend/assets
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/dist/server.js"]
