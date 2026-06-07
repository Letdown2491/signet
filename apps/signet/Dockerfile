FROM node:20-slim AS build

WORKDIR /app

# Install pnpm (pinned for reproducible builds)
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Copy root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy package.json files for all workspaces
COPY apps/signet/package.json ./apps/signet/
COPY packages/signet-types ./packages/signet-types

# Install dependencies (prepare script builds signet-types)
ENV CI=true
RUN pnpm install --frozen-lockfile


# Copy source files
COPY apps/signet ./apps/signet

# Build daemon
WORKDIR /app/apps/signet
ENV DATABASE_URL="file:/app/config/signet.db"
RUN pnpm prisma generate
RUN pnpm build

# Runtime stage
FROM node:20-slim AS runtime

WORKDIR /app

# Runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends openssl wget ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy the entire workspace with compiled node_modules from build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/signet-types ./packages/signet-types

# Copy app with its node_modules and built files
COPY --from=build /app/apps/signet/node_modules ./apps/signet/node_modules
COPY --from=build /app/apps/signet/package.json ./apps/signet/
COPY --from=build /app/apps/signet/dist ./apps/signet/dist
COPY --from=build /app/apps/signet/prisma ./apps/signet/prisma
COPY --from=build /app/apps/signet/prisma.config.ts ./apps/signet/prisma.config.ts
COPY --from=build /app/apps/signet/entrypoint.sh ./apps/signet/entrypoint.sh

RUN chmod +x ./apps/signet/entrypoint.sh

# Runtime invokes prisma via its locally-installed binary (./node_modules/.bin/prisma),
# so pnpm/corepack are not needed in the runtime image.

# Run as the non-root `node` user (uid 1000) that ships with the base image.
# The config volume holds keys/secrets — mount a host directory owned by uid 1000
# (e.g. `chown -R 1000:1000 ~/.signet-config`) so the daemon can write to it.
RUN mkdir -p /app/config && chown -R node:node /app
USER node

WORKDIR /app/apps/signet

# Environment variables (can be overridden at runtime)
ENV DATABASE_URL="file:/app/config/signet.db"
ENV SIGNET_PORT=3000
ENV SIGNET_HOST=0.0.0.0

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["start", "--config", "/app/config/signet.json"]
