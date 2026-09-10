.PHONY: dev reset test typecheck seed tunnel

# Whichever container the local Supabase stack is running Postgres in.
DB := $(shell docker ps --filter name=supabase_db_ --format '{{.Names}}' | head -1)

dev:            ## Supabase local stack + the app with hot reload
	supabase start && docker compose up web

reset:          ## Re-apply every migration and reseed
	supabase db reset
	@$(MAKE) --no-print-directory seed-admin

seed-admin:     ## Point the seeded admin row at $SEED_ADMIN_EMAIL (spec §9: never hardcoded)
	@test -n "$(DB)" || { echo "supabase is not running: make dev"; exit 1; }
	@test -n "$$SEED_ADMIN_EMAIL" || { echo "SEED_ADMIN_EMAIL is unset; keeping the seed fallback"; exit 0; }
	@docker exec -i $(DB) psql -qU postgres -d postgres \
	  -c "insert into app_users (email, role) values ('$$SEED_ADMIN_EMAIL', 'admin') \
	      on conflict (email) do update set role = 'admin'" \
	  -c "delete from app_users where email = 'seed-admin@umich.edu' and email <> '$$SEED_ADMIN_EMAIL'"
	@echo "admin: $$SEED_ADMIN_EMAIL"

seed:           ## Regenerate supabase/seed.sql (deterministic; commit the result)
	pnpm seed:generate

test:
	pnpm test

typecheck:
	pnpm typecheck

tunnel:         ## Public URL for the Slack/Tally webhook routes during development
	docker compose --profile tunnel up slack-tunnel
