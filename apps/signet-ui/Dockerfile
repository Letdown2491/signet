FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
ENV PORT=4174
ENV HOST=0.0.0.0
ENV DAEMON_URL=http://signet:3000
EXPOSE 4174
CMD ["node", "server.mjs"]
