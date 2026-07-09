# Context Graph — the whole engine in one container.
#
#   docker compose up          → web UI at http://localhost:4680
#                                MCP (HTTP) at http://localhost:4680/mcp
#
# Runs `context-graph serve`: the web UI, the MCP server (over HTTP), and the
# folder watcher share one engine and one port. The graph persists to the /data
# volume as a single SQLite file. The server binds 0.0.0.0 inside the container
# and requires the access token printed in the container logs on first start
# (or set CONTEXT_GRAPH_WEB_TOKEN); the token also gates /mcp.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# `prepare` would try to compile before src is copied; native-module install
# scripts (better-sqlite3) must still run, so drop only the prepare hook.
RUN npm pkg delete scripts.prepare && npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json \
  && mkdir -p dist/web && cp src/web/ui.html dist/web/ui.html \
  && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4680 \
    CONTEXT_GRAPH_DB=/data/graph.db \
    CONTEXT_GRAPH_MODEL_CACHE=/data/.model-cache
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4680
VOLUME /data
# Resumes any registered watch folders; mount them and register via the UI or
# `context-graph watch <dir>` so they persist in the /data volume.
CMD ["node", "dist/serve.js"]
