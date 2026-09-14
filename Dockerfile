# syntax=docker/dockerfile:1

# ---- build stage -----------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

# Manifests first, so `npm ci` only reruns when a dependency actually changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

# Now the real source.
COPY shared shared
COPY server server
COPY client client

# Builds client/dist/client (static assets) and client/dist/server (the SSR
# bundle) — see client/vite.config.ts.
RUN npm run build --workspace client

# Drop devDependencies (vite, typescript, @types/*, etc.) — the server runs
# its TypeScript source directly via Node's native type stripping, and in
# production mode (SAVIT_STATIC_DIR set) it never touches Vite at runtime.
RUN npm prune --omit=dev

# ---- runtime stage ----------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    SAVIT_HOST=0.0.0.0 \
    SAVIT_PORT=4318 \
    SAVIT_STATIC_DIR=/app/client/dist/client

# Pruned node_modules (incl. the @savit/shared workspace symlink — npm
# creates it as an absolute path, e.g. /app/shared, so WORKDIR must match
# the build stage exactly for it to still resolve here), server source,
# and the built client.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/src server/src
COPY --from=build /app/client/dist client/dist

EXPOSE 4318

# No curl in the slim image — Node's built-in fetch instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SAVIT_PORT||4318)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Stateless — TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be supplied at
# `docker run`/compose time, never baked into the image.
CMD ["node", "server/src/index.ts"]
