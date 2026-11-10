# The hosted console: one small container, an MCP client of one upstream portal.
# It carries no credentials; every setting arrives as a CONSOLE_* environment variable at run time.

FROM node:22.21.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.ui.json ./
COPY scripts ./scripts
COPY src ./src
COPY test ./test
COPY docs ./docs
RUN npm run ui:build

FROM node:22.21.1-bookworm-slim
ENV NODE_ENV=production \
    CONSOLE_MODE=hosted \
    CONSOLE_BIND_ADDRESS=0.0.0.0 \
    PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/dist/ui ./dist/ui
USER node
EXPOSE 8080
CMD ["node", "dist/src/console/cli.js"]
