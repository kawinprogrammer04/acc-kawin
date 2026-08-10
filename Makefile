# ══════════════════════════════════════════════════════════════════════════════
# Makefile — Thai SME Accounting System
# Usage: make <target>
# ══════════════════════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help
SHELL         := /bin/bash
ENV_FILE      ?= .env
DC            = docker compose --env-file $(ENV_FILE)

# Load .env so variables are available in make targets
-include $(ENV_FILE)
export

.PHONY: help setup ssl-self-signed up down restart build rebuild \
        logs logs-backend logs-frontend logs-db \
        db-shell db-backup db-restore \
        ps health check migrate migration-current test-backend config clean nuke

# ── Help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  Thai SME Accounting System — Make targets"
	@echo ""
	@echo "  Setup"
	@echo "    make setup            Copy .env.example → .env, create data dirs"
	@echo "    make ssl-self-signed  Generate self-signed TLS cert (dev only)"
	@echo ""
	@echo "  Run"
	@echo "    make up               Start all services (detached)"
	@echo "    make down             Stop all services"
	@echo "    make restart          Restart all services"
	@echo "    make build            Build images without cache"
	@echo "    make rebuild          Build + up"
	@echo ""
	@echo "  Logs"
	@echo "    make logs             Tail all logs"
	@echo "    make logs-backend     Tail backend logs"
	@echo "    make logs-frontend    Tail frontend/nginx logs"
	@echo "    make logs-db          Tail postgres logs"
	@echo ""
	@echo "  Database"
	@echo "    make db-shell         Open psql prompt"
	@echo "    make db-backup        Manual backup now"
	@echo "    make db-restore F=<file>  Restore from dump file"
	@echo "    make migrate          Apply all pending Alembic migrations"
	@echo "    make migration-current Show current Alembic revision"
	@echo "    make test-backend     Run backend unit tests in a one-off container"
	@echo ""
	@echo "  Ops"
	@echo "    make ps               Show container status"
	@echo "    make health           Check all healthchecks"
	@echo "    make check            Validate nginx + backend configs"
	@echo "    make config           Validate compose with ENV_FILE (default .env)"
	@echo "    make clean            Remove stopped containers + dangling images"
	@echo "    make nuke             ⚠  Remove ALL containers, images, and volumes"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
setup:
	@if [ ! -f $(ENV_FILE) ]; then \
		cp .env.example $(ENV_FILE); \
		echo "✓ Created .env — fill in your secrets before continuing"; \
	else \
		echo "✓ .env already exists"; \
	fi
	@mkdir -p data/postgres data/backups nginx/ssl
	@echo "✓ Data directories created"

ssl-self-signed:
	@bash scripts/gen-self-signed.sh "$(DOMAIN)"

# ── Run ───────────────────────────────────────────────────────────────────────
up:
	$(DC) up -d

down:
	$(DC) down

restart:
	$(DC) restart

build:
	$(DC) build --no-cache

rebuild: build up

# ── Logs ──────────────────────────────────────────────────────────────────────
logs:
	$(DC) logs -f --tail=100

logs-backend:
	$(DC) logs -f --tail=100 backend

logs-frontend:
	$(DC) logs -f --tail=100 frontend

logs-db:
	$(DC) logs -f --tail=100 db

# ── Database ──────────────────────────────────────────────────────────────────
db-shell:
	$(DC) exec db psql -U "$(POSTGRES_USER)" -d "$(POSTGRES_DB)"

db-backup:
	$(DC) exec db_backup sh /backup.sh

db-restore:
	@[ -n "$(F)" ] || { echo "Usage: make db-restore F=<path-to-dump>"; exit 1; }
	@bash scripts/restore.sh "$(F)"

migrate:
	$(DC) exec backend alembic upgrade head

migration-current:
	$(DC) exec backend alembic current

test-backend:
	$(DC) run --rm --no-deps \
		-v "$(CURDIR)/backend/tests:/app/tests:ro" \
		backend python -m unittest discover -s tests -v

# ── Ops ───────────────────────────────────────────────────────────────────────
ps:
	$(DC) ps

health:
	@echo "=== Container health status ==="
	@docker inspect --format '{{.Name}}  {{.State.Health.Status}}' \
		$$($(DC) ps -q) 2>/dev/null || echo "(no containers running)"

check:
	@echo "--- Checking Nginx config ---"
	$(DC) exec frontend nginx -t
	@echo ""
	@echo "--- Backend health endpoint ---"
	@curl -sk https://localhost/api/health | python3 -m json.tool || \
	 curl -s  http://localhost/api/health  | python3 -m json.tool

config:
	$(DC) config --quiet

clean:
	$(DC) down --remove-orphans
	docker image prune -f

nuke:
	@echo "⚠  This will remove all containers, images, and volumes for this project."
	@read -p "Type 'yes' to confirm: " CONFIRM && [ "$$CONFIRM" = "yes" ] || { echo "Aborted."; exit 0; }
	$(DC) down --volumes --remove-orphans
	docker image rm -f acc_backend:latest acc_frontend:latest 2>/dev/null || true
	@echo "✓ Done"
