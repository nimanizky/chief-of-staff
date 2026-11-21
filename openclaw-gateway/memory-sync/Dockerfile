FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY sync.mjs known_hosts test.mjs ./
RUN mkdir -p /workspace /tmp/home \
    && chown -R node:node /app /workspace /tmp/home

USER node
ENV HOME=/tmp/home
ENTRYPOINT ["node", "/app/sync.mjs"]
