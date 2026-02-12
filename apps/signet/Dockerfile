FROM node:20-slim AS build

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy package.json files for all workspaces
COPY apps/signet/package.json ./apps/signet/
COPY packages/signet-types ./packages/signet-types

# Install dependencies (prepare script builds signet-types)
ENV CI=true
RUN pnpm install --frozen-lockfile

# Ensure better-sqlite3 native bindings are installed (prebuild-install downloads prebuilt binaries)
RUN cd /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npx --yes prebuild-install -d

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

# Install pnpm for runtime commands (prisma migrate)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app/apps/signet

# Environment variables (can be overridden at runtime)
ENV DATABASE_URL="file:/app/config/signet.db"
ENV SIGNET_BIND_PORT=3000
ENV SIGNET_BIND_ADDRESS=0.0.0.0

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["start", "--config", "/app/config/signet.json"]
