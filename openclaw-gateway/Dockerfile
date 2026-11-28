FROM node:24-bookworm-slim

# The slim base image may not include the system CA bundle. Codex app-server
# needs it to validate TLS connections to ChatGPT/OpenAI endpoints.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY bootstrap.mjs migrate-workspace.mjs docker-entrypoint.sh openclaw.example.json run.mjs whatsapp-handoff.mjs patch-whatsapp-handoff.mjs ./
COPY mcp-server ./mcp-server
RUN node patch-whatsapp-handoff.mjs
RUN mkdir -p /home/node/.openclaw /workspace \
    && chown -R node:node /home/node/.openclaw /workspace
USER node
ENV OPENCLAW_STATE_DIR=/home/node/.openclaw
CMD ["sh", "/app/docker-entrypoint.sh"]
