
FROM oven/bun:1 as install

RUN mkdir -p /temp/prod
#COPY /temp/prod /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --production --frozen-lockfile


FROM node:19-bullseye as base
COPY --from=install /temp/prod/node_modules node_modules

COPY /build /build

COPY package-build.json /build/package.json

ENTRYPOINT ["node", "-r", "dotenv/config", "build"]