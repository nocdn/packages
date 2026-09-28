# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS base
WORKDIR /usr/src/app

FROM base AS build

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN bun run build

FROM base AS release
ENV NODE_ENV=production

COPY --from=build --chown=bun:bun /usr/src/app/dist ./dist

EXPOSE {{port}}

USER bun
CMD ["bun", "run", "dist/index.js"]
