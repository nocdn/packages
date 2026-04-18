# syntax=docker/dockerfile:1

FROM oven/bun:1-alpine AS build
WORKDIR /usr/src/app

COPY package.json ./
COPY bun.lock* ./
RUN if [ -f bun.lock ]; then bun install --frozen-lockfile --production; else bun install --production; fi

COPY . ./
RUN bun build ./src/index.ts --compile --minify --outfile app

FROM alpine:latest AS release
WORKDIR /usr/src/app

ENV NODE_ENV=production

RUN apk add --no-cache libgcc libstdc++

COPY --from=build /usr/src/app/app ./app

EXPOSE {{port}}

CMD ["./app"]
