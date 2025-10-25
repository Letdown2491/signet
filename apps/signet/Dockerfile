FROM node:20.11-bullseye AS build

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Generate prisma client and build the application
RUN npx prisma generate
RUN npm run build

# Remove dev dependencies to reduce size
RUN npm prune --production

# Runtime stage
FROM node:20.11-alpine AS runtime

WORKDIR /app

RUN apk update && \
    apk add --no-cache openssl wget && \
    rm -rf /var/cache/apk/*

# Copy package files and node_modules from build stage
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules

# Copy Prisma schema and generate client
COPY --from=build /app/prisma ./prisma
RUN npx prisma generate

# Copy built application
COPY --from=build /app/dist ./dist

EXPOSE 3000

ENTRYPOINT [ "node", "./dist/index.js" ]
CMD ["start"]
