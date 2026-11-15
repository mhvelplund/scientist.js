VERSION 0.8

# Containerized build for the npm package. Mirrors the mise tasks in mise.toml:
#
#   earth +ci                      lint, typecheck, test, build, smoke
#   earth +build                   build dist/ and copy it back to the host
#   earth +pack                    write the publishable tarball to the host
#
# Publishing happens in .github/workflows/release.yml, which runs `npm publish` on the +pack
# tarball with npm trusted publishing (no npm token is stored anywhere).

ARG --global NODE_VERSION=24

FROM node:$NODE_VERSION-bookworm-slim
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /pkg

deps:
    COPY package.json package-lock.json ./
    CACHE /root/.npm
    RUN npm ci
    SAVE ARTIFACT node_modules

src:
    FROM +deps
    COPY biome.json tsconfig.json tsdown.config.ts vitest.config.ts ./
    COPY --dir src test docs ./
    COPY README.md LICENSE ./

lint:
    FROM +src
    RUN npx biome check .

typecheck:
    FROM +src
    RUN npx tsc --noEmit

test:
    FROM +src
    RUN npx vitest run --coverage
    SAVE ARTIFACT coverage AS LOCAL coverage

build:
    FROM +src
    RUN npx tsdown
    SAVE ARTIFACT dist AS LOCAL dist

smoke:
    FROM +src
    COPY +build/dist dist
    RUN node test/smoke/smoke.cjs
    RUN node test/smoke/smoke.mjs
    RUN npx tsc -p test/smoke/tsconfig.json

pack:
    FROM +src
    COPY +build/dist dist
    RUN npm pack
    SAVE ARTIFACT *.tgz AS LOCAL ./

ci:
    BUILD +lint
    BUILD +typecheck
    BUILD +test
    BUILD +build
    BUILD +smoke
