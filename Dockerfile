# The API image: the esbuild bundle and the configuration, nothing else. Built and pinned by digest in CI.
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm exec tsx scripts/build.ts

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production ROP_ROOT=/app PORT=8080
COPY --from=build /src/dist/api ./dist/api
COPY --from=build /src/config ./config
EXPOSE 8080
CMD ["dist/api/main.js"]
