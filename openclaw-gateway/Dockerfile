FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY bootstrap.mjs docker-entrypoint.sh openclaw.example.json ./
RUN mkdir -p /home/node/.openclaw && chown -R node:node /home/node/.openclaw
USER node
ENV OPENCLAW_STATE_DIR=/home/node/.openclaw
CMD ["sh", "/app/docker-entrypoint.sh"]
