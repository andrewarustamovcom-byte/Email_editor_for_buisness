FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 AI_PROVIDER=yandex
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /app/var && chown node:node /app/var
COPY --from=build /app/dist/api ./dist/api
COPY --from=build /app/dist/email-review.ru.md ./dist/email-review.ru.md
USER node
EXPOSE 8787
CMD ["node", "dist/api/server.js"]
