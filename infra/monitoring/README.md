# API Downtime Alerting

This directory contains the monitoring configuration used to detect AnchorPoint API downtime and route critical incidents to PagerDuty and Slack.

## What is monitored

1. Prometheus scrape health for the backend metrics target.
2. A synthetic HTTP probe against `GET /health`.
3. A warning signal for probe flapping before a full outage occurs.
4. HTTP 5xx error spikes (`HighErrorRate`) — 5xx responses above 5% of total traffic over a rolling 5-minute window (#1008).
5. Database connection-pool exhaustion (`DatabaseConnectionExhausted`) — in-flight pool connections at or above 90% of the configured Prisma `connection_limit` (`DB_CONNECTION_LIMIT`) (#1008).

## Metrics used by the alerts

The rules only reference metrics actually exported by the backend
(`backend/src/services/metrics.service.ts`):

| Metric | Type | Source |
| --- | --- | --- |
| `http_requests_total{method,path,status_code}` | counter | per-request recording middleware |
| `db_pool_connections_active` | gauge | Prisma `$use` middleware in `backend/src/lib/prisma.ts`; counts in-flight queries |
| `db_pool_max_connections` | gauge | set once at startup from `DB_CONNECTION_LIMIT` |

## Alert routing

Critical alerts are routed to PagerDuty through Alertmanager.
Warning alerts use the same PagerDuty routing key so they remain visible in the same incident stream, but they are grouped and can be inhibited by the corresponding critical alert.

`HighErrorRate` and `DatabaseConnectionExhausted` are additionally mirrored to Slack via the `slack-alerts` receiver while still falling through to the PagerDuty severity routing (`continue: true`).

## Files

- `prometheus-alerts.yml`: Prometheus alert rules for API downtime.
- `alertmanager.yml`: PagerDuty + Slack routing and grouping policy.
- `blackbox.yml`: Synthetic HTTP probe module for the `/health` endpoint.
- `../prometheus/alerts.rules.yml`: API performance rules (`HighErrorRate`, `DatabaseConnectionExhausted`, `HighP99Latency`).

## Validation

```bash
# Prometheus rule files
promtool check rules ../prometheus/alerts.rules.yml prometheus-alerts.yml

# Full Prometheus configuration (resolves rule_files entries)
promtool check config ../../prometheus.yml

# Alertmanager configuration (amtool ships with Alertmanager)
amtool check-config alertmanager.yml
```

## Manual QA

1. Start the stack with `docker compose --profile monitoring up`.
2. Confirm Prometheus loads both rule files (`http://localhost:9090/rules`) and shows `HighErrorRate`, `DatabaseConnectionExhausted`, `AnchorPointApiTargetDown`, etc.
3. Temporarily stop the backend container.
4. Verify `AnchorPointApiTargetDown` fires within about 2 minutes.
5. Restart the backend.
6. Confirm the alert resolves and Alertmanager sends resolved notifications to PagerDuty/Slack.

## Notification credentials

Set the following in the environment of the Alertmanager container (see `.env.example`). They are intentionally not committed to the repository:

- `PAGERDUTY_ROUTING_KEY` — PagerDuty Events API v2 routing key.
- `SLACK_WEBHOOK_URL` — Incoming Webhook URL used by the `slack-alerts` receiver.
- `SLACK_ALERT_CHANNEL` — Slack channel for alert notifications (defaults to `#alerts` via Docker Compose).

Alertmanager must be started with `--config.expand-env=true` (already configured in `docker-compose.yml`) so the `${VAR}` placeholders in `alertmanager.yml` resolve at runtime.
