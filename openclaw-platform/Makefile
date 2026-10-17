SHELL := /bin/bash
OPENCLAW := ./scripts/openclaw-local.sh
ENV_FILE := .env

.PHONY: help install install-host env-check validate-schema build backfill parity-compare telegram-user-id finance-digest-preview finance-digest-send finance-sheets-sync test-finance \
	openclaw-version onboard gateway pairing-list-telegram pairing-approve-telegram \
	logs status health doctor doctor-fix gateway-mode-local security-audit sandbox-enable sandbox-disable sandbox-explain \
	sandbox-recreate sandbox-network-none sandbox-network-bridge sandbox-network-custom \
	sandbox-egress-allowlist config-sync config-validate colima-up colima-down colima-status docker-check docker-build \
	docker-up docker-down docker-logs

help:
	@echo "Targets:"
	@echo "  make install"
	@echo "  make install-host"
	@echo "  make validate-schema"
	@echo "  make build"
	@echo "  make backfill INPUT=./path/to/backfill.json"
	@echo "  make parity-compare BASELINE=./baseline.json SANDBOX=./sandbox.json"
	@echo "  make telegram-user-id"
	@echo "  make test-finance"
	@echo "  make finance-digest-preview"
	@echo "  make finance-digest-send"
	@echo "  make finance-sheets-sync"
	@echo "  make openclaw-version"
	@echo "  make onboard"
	@echo "  make gateway"
	@echo "  make pairing-list-telegram"
	@echo "  make pairing-approve-telegram PAIR_CODE=..."
	@echo "  make logs"
	@echo "  make status"
	@echo "  make health"
	@echo "  make doctor"
	@echo "  make doctor-fix"
	@echo "  make gateway-mode-local"
	@echo "  make security-audit"
	@echo "  make sandbox-enable"
	@echo "  make sandbox-disable"
	@echo "  make sandbox-explain"
	@echo "  make sandbox-recreate"
	@echo "  make sandbox-network-none"
	@echo "  make sandbox-network-bridge"
	@echo "  make sandbox-network-custom SANDBOX_DOCKER_NETWORK=openclaw-sandbox-egress"
	@echo "  make sandbox-egress-allowlist"
	@echo "  make config-sync"
	@echo "  make config-validate"
	@echo "  make colima-up"
	@echo "  make colima-status"
	@echo "  make colima-down"
	@echo "  make docker-check"
	@echo "  make docker-build"
	@echo "  make docker-up"
	@echo "  make docker-logs"
	@echo "  make docker-down"

install:
	npm install

install-host:
	brew install colima docker docker-compose poppler

env-check:
	@test -f $(ENV_FILE) || (echo "Missing .env. Run: cp .env.example .env" >&2; exit 1)

validate-schema: env-check
	npm run validate-schema

build: env-check
	npm run build

backfill: env-check
	@test -n "$(INPUT)" || (echo "Usage: make backfill INPUT=./path/to/backfill.json" >&2; exit 1)
	npm run backfill -- --input "$(INPUT)"

parity-compare:
	@test -n "$(BASELINE)" || (echo "Usage: make parity-compare BASELINE=./baseline.json SANDBOX=./sandbox.json" >&2; exit 1)
	@test -n "$(SANDBOX)" || (echo "Usage: make parity-compare BASELINE=./baseline.json SANDBOX=./sandbox.json" >&2; exit 1)
	npm run parity-compare -- --baseline "$(BASELINE)" --sandbox "$(SANDBOX)"

telegram-user-id: env-check
	@set -a; source "$(ENV_FILE)"; set +a; python3 ./scripts/telegram_user_id.py

test-finance:
	npm run test:finance

finance-digest-preview: env-check
	npm run finance:digest:preview

finance-digest-send: env-check
	npm run finance:digest:send

finance-sheets-sync: env-check
	npm run finance:sheets-sync

openclaw-version:
	$(OPENCLAW) --version

onboard:
	$(OPENCLAW) onboard

gateway: build config-sync
	$(OPENCLAW) gateway

pairing-list-telegram:
	$(OPENCLAW) pairing list telegram

pairing-approve-telegram:
	@test -n "$(PAIR_CODE)" || (echo "Usage: make pairing-approve-telegram PAIR_CODE=..." >&2; exit 1)
	$(OPENCLAW) pairing approve telegram "$(PAIR_CODE)"

logs:
	$(OPENCLAW) logs --follow

status:
	$(OPENCLAW) status

health:
	$(OPENCLAW) health

doctor:
	$(OPENCLAW) doctor

doctor-fix:
	$(OPENCLAW) doctor --fix

gateway-mode-local:
	$(OPENCLAW) config set gateway.mode "local"

security-audit:
	$(OPENCLAW) security audit

sandbox-enable:
	$(OPENCLAW) config set agents.defaults.sandbox.mode "all"
	$(OPENCLAW) config set agents.defaults.sandbox.scope "session"
	$(OPENCLAW) config set agents.defaults.sandbox.workspaceAccess "rw"

sandbox-disable:
	$(OPENCLAW) config set agents.defaults.sandbox.mode "off"

sandbox-explain:
	$(OPENCLAW) sandbox explain

sandbox-recreate:
	$(OPENCLAW) sandbox recreate --all --force

sandbox-network-none:
	$(OPENCLAW) config set agents.defaults.sandbox.docker.network "none"

sandbox-network-bridge:
	$(OPENCLAW) config set agents.defaults.sandbox.docker.network "bridge"

sandbox-network-custom:
	@test -n "$(SANDBOX_DOCKER_NETWORK)" || (echo "Usage: make sandbox-network-custom SANDBOX_DOCKER_NETWORK=openclaw-sandbox-egress" >&2; exit 1)
	$(OPENCLAW) config set agents.defaults.sandbox.docker.network "$(SANDBOX_DOCKER_NETWORK)"

sandbox-egress-allowlist:
	@echo "Sandbox egress allowlist domains:"
	@cat ./config/sandbox-egress-allowlist.txt

config-sync:
	node ./scripts/sync-openclaw-config.mjs

config-validate: config-sync
	$(OPENCLAW) config validate

colima-up:
	colima start

colima-down:
	colima stop

colima-status:
	colima status

docker-check:
	docker ps

docker-build:
	docker compose build

docker-up:
	docker compose up -d gateway finance-sheet-sync

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f gateway
