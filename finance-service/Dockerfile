FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
# poppler-utils provides pdftoppm, used to rasterize PDF wealth snapshots
# before they are sent to the vision model.
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config ./config
ENV NODE_ENV=production
CMD ["npm", "start"]
