FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
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
COPY --from=build /app/apps/signet-ui/dist ./dist
COPY --from=build /app/apps/signet-ui/server.mjs ./server.mjs
# Install server dependencies (pinned to match package.json)
RUN npm install --no-save express@4 express-rate-limit@7 http-proxy-middleware@3 basic-auth@2

# Environment variables (can be overridden at runtime)
ENV UI_BIND_PORT=4174
ENV UI_BIND_ADDRESS=0.0.0.0
ENV SIGNET_URL=http://signet:3000

EXPOSE 4174
CMD ["node", "server.mjs"]
