# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS workspace
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/renderer/package.json packages/renderer/package.json
RUN pnpm install --frozen-lockfile
# Uses the exact Playwright version locked in @cert/renderer, including its matching Chromium.
RUN pnpm --filter @cert/renderer exec playwright install --with-deps chromium
# poppler-utils rasterises PDF certificate backgrounds (first page to PNG).
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm db:generate
RUN pnpm build
RUN mkdir -p /data/storage && chown -R node:node /data /ms-playwright

FROM workspace AS runtime
LABEL io.cert-app.managed=true
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV STORAGE_ROOT=/data/storage
ENV CHROMIUM_SANDBOX=false
USER node
EXPOSE 3001
CMD ["pnpm", "exec", "tsx", "apps/api/src/index.ts"]

FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS web
LABEL io.cert-app.managed=true
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=workspace /app/apps/web/dist /usr/share/nginx/html
# Vite preserves permissions of public files copied from the checkout.
RUN find /usr/share/nginx/html -type d -exec chmod 755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 644 {} +
EXPOSE 8080
