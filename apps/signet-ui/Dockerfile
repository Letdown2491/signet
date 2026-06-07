FROM node:20-slim AS build
WORKDIR /app
# Pinned pnpm for reproducible builds
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/signet-ui/package.json ./apps/signet-ui/
COPY packages/signet-types ./packages/signet-types
RUN pnpm install --frozen-lockfile
COPY apps/signet-ui ./apps/signet-ui
WORKDIR /app/apps/signet-ui
RUN pnpm build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Reuse the lockfile-resolved dependencies from the build stage (express,
# http-proxy-middleware, and the http-proxy -> http-proxy-3 override) instead of a
# separate, unpinned `npm install` that bypasses pnpm-lock.yaml.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/signet-ui/node_modules ./apps/signet-ui/node_modules
COPY --from=build /app/apps/signet-ui/package.json ./apps/signet-ui/
COPY --from=build /app/apps/signet-ui/dist ./apps/signet-ui/dist
COPY --from=build /app/apps/signet-ui/server.mjs ./apps/signet-ui/server.mjs

# Run as the non-root `node` user that ships with the base image.
RUN chown -R node:node /app
USER node

WORKDIR /app/apps/signet-ui

# Environment variables (can be overridden at runtime)
ENV UI_PORT=4174
ENV UI_HOST=0.0.0.0
ENV DAEMON_URL=http://signet:3000

EXPOSE 4174
CMD ["node", "server.mjs"]
