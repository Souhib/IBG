# Data Infrastructure Plan — 4 Phases

## Context

Majlisna is a real-time multiplayer game platform (FastAPI + React + PostgreSQL + Socket.IO). The app works well but has no analytics, no log aggregation, no distributed tracing, and no data pipelines. This plan adds a complete data infrastructure in 4 incremental phases, each building on the previous. The goal is learning industry-standard tools (Kafka/Redpanda, ClickHouse, Jaeger, Fluentd, Airbyte, Airflow, Flink) while making them genuinely useful for the project.

**Current stack**: PostgreSQL 16 + PgBouncer + Redis (Socket.IO only) + FastAPI + React + Nginx. Monitoring: GlitchTip, Umami, Beszel, Uptime Kuma, Dozzle, CrowdSec, Homepage.

**Server**: Oracle VPS, 24GB RAM, ~7GB used, ~17GB free.

**Key constraint**: Never break the game flow. Event production is always fire-and-forget alongside the existing REST → Controller → DB → Socket.IO path.

---

## Phase 1 — Event Streaming + Analytics (Redpanda + ClickHouse)

### Goal

Capture every meaningful user/game/room action as a structured event, stream it through a message broker, and land it in a columnar OLAP database for fast analytical queries.

### Architecture

```
FastAPI Route → Controller → DB commit → await notify_*() → fire_event() (async, non-blocking)
                                                                    │
                                                                    ▼
                                                              Redpanda (broker)
                                                                    │
                                                                    ▼
                                                          Event Consumer (Python)
                                                                    │
                                                                    ▼
                                                          ClickHouse (OLAP)
```

The `fire_event()` call is **fire-and-forget** via `asyncio.create_task()`. If Redpanda is unreachable, the event is silently lost and the game continues unaffected. This follows the same pattern as `fire_notify_*()` in `notify.py` — a `_pending_tasks` set holds strong references to prevent garbage collection.

### Docker Services

All new infrastructure services live in `~/monitoring/docker-compose.yml` on the server (separate from the app compose managed by Dokploy).

| Service | Image | RAM Limit | Exposed Ports | Networks |
|---------|-------|-----------|---------------|----------|
| redpanda | `docker.redpanda.com/redpandadata/redpanda:v24.3.1` | 512MB | 19092 (Kafka API), 18081 (Schema Registry) | dokploy-network, internal |
| redpanda-console | `docker.redpanda.com/redpandadata/console:v2.8.0` | 128MB | 31800 (Web UI) | dokploy-network |
| clickhouse | `clickhouse/clickhouse-server:24.12-alpine` | 1GB | 18123 (HTTP API), 19000 (native protocol) | dokploy-network, internal |
| event-consumer | Custom Python image (built from `~/monitoring/consumers/`) | 256MB | none | internal |

**Redpanda** runs in single-node dev mode: `redpanda start --mode dev-container --smp 1 --memory 512M`. This disables replication (acceptable for a learning/analytics use case — event loss is tolerable).

**ClickHouse** uses the alpine image for minimal footprint. Data persisted to a named Docker volume.

**Redpanda Console** provides a web UI at port 31800 for browsing topics, messages, consumer groups, and schema registry. Accessible via `redpanda.majlisna.app` through Traefik.

### Topics & Event Schema

**3 Kafka topics**: `game.events`, `user.events`, `room.events`. All use JSON format with optional Schema Registry validation.

**Common envelope** (every event):

```json
{
  "event_id": "uuid4",
  "event_type": "string (e.g. game.started)",
  "game_id": "uuid | empty string",
  "room_id": "uuid | empty string",
  "user_id": "uuid",
  "game_type": "undercover | codenames | word_quiz | mcq_quiz | empty string",
  "timestamp": "ISO8601 with timezone",
  "data": { /* event-type-specific payload */ }
}
```

**`game.events` types**:

| Event Type | Data Fields | Source Route |
|------------|-------------|-------------|
| `game.started` | `{num_players, settings}` | `POST /{game}/games/{room_id}/start` |
| `game.finished` | `{winner, duration_seconds, num_rounds}` | Emitted by controller when game ends |
| `vote.submitted` | `{voted_for, round_number}` | `POST /undercover/games/{id}/vote` |
| `description.submitted` | `{word, round_number}` | `POST /undercover/games/{id}/describe` |
| `clue.given` | `{clue_word, clue_number, team}` | `POST /codenames/games/{id}/clue` |
| `card.guessed` | `{card_index, card_type, result, team}` | `POST /codenames/games/{id}/guess` |
| `answer.submitted` | `{correct, points, hint_number, round_number}` | `POST /wordquiz|mcqquiz/games/{id}/answer` |
| `hint.viewed` | `{word}` | `POST /{game}/games/{id}/hint-viewed` |

**`user.events` types**: `user.registered`, `user.logged_in`, `achievement.unlocked`

**`room.events` types**: `room.created`, `room.joined`, `room.left`, `room.kicked`, `room.spectator_joined`

### Backend Code Changes

#### New file: `backend/majlisna/api/services/events.py`

This is the event producer module. Key design:

- `init_producer(brokers: str)` — creates an `aiokafka.AIOKafkaProducer`, called from lifespan startup
- `shutdown_producer()` — flushes and closes, called from lifespan shutdown
- `fire_event(topic, event_type, **kwargs)` — builds the envelope, calls `asyncio.create_task(_produce(...))`, returns immediately
- `_produce(topic, event)` — async send with `send_and_wait()`, swallows all exceptions
- If `_producer is None` (brokers not configured or init failed), `fire_event()` is a no-op
- Uses `_pending_tasks: set[asyncio.Task]` pattern from `notify.py` for GC protection

Producer config: `acks=1`, `linger_ms=50` (batching), `request_timeout_ms=5000`.

#### Modified: `backend/majlisna/settings.py`

Add one field to `Settings`:

```python
# Event Streaming (Redpanda/Kafka)
redpanda_brokers: str = ""  # Empty = events disabled
```

When empty, `init_producer()` is never called, and `fire_event()` is always a no-op. Zero overhead in dev/test.

#### Modified: `backend/main.py`

In the lifespan context manager, after DB init and before `yield`:

```python
from majlisna.api.services.events import init_producer, shutdown_producer

if settings.redpanda_brokers:
    await init_producer(settings.redpanda_brokers)
```

On shutdown (after checker task cancel, before engine dispose):

```python
await shutdown_producer()
```

#### Modified: `backend/pyproject.toml`

Add dependency:

```
"aiokafka>=0.12.0"
```

`aiokafka` is a pure-Python async Kafka client. It's lightweight and doesn't require librdkafka compilation.

#### Modified route files

Each route gets a `fire_event()` call **after** the existing `notify_*()` calls. The import is added at the top of each file:

```python
from majlisna.api.services.events import fire_event
```

**`routes/undercover.py`** — 5 events:
- `start_undercover_game`: `fire_event("game.events", "game.started", game_type="undercover", ...)`
- `submit_description`: `fire_event("game.events", "description.submitted", ...)`
- `submit_vote`: `fire_event("game.events", "vote.submitted", ...)`
- `timer_expired`: `fire_event("game.events", "timer.expired", ...)`
- `record_hint_viewed`: `fire_event("game.events", "hint.viewed", ...)`

**`routes/codenames.py`** — 5 events:
- `start_codenames_game`: `fire_event("game.events", "game.started", game_type="codenames", ...)`
- `give_clue`: `fire_event("game.events", "clue.given", ...)`
- `guess_card`: `fire_event("game.events", "card.guessed", ...)`
- `timer_expired`: `fire_event("game.events", "timer.expired", ...)`
- `end_turn`: `fire_event("game.events", "turn.ended", ...)`

**`routes/wordquiz.py`** — 4 events:
- `start_wordquiz_game`: `fire_event("game.events", "game.started", game_type="word_quiz", ...)`
- `submit_answer`: `fire_event("game.events", "answer.submitted", ...)`
- `timer_expired`: `fire_event("game.events", "timer.expired", ...)`
- `record_hint_viewed`: `fire_event("game.events", "hint.viewed", ...)`

**`routes/mcqquiz.py`** — 3 events:
- `start_mcqquiz_game`: `fire_event("game.events", "game.started", game_type="mcq_quiz", ...)`
- `submit_answer`: `fire_event("game.events", "answer.submitted", ...)`
- `timer_expired`: `fire_event("game.events", "timer.expired", ...)`

**`routes/room.py`** — 5 events:
- `create_room`: `fire_event("room.events", "room.created", ...)`
- `join_room`: `fire_event("room.events", "room.joined", ...)`
- `leave_room`: `fire_event("room.events", "room.left", ...)`
- `kick_player`: `fire_event("room.events", "room.kicked", ...)`
- `join_room_as_spectator`: `fire_event("room.events", "room.spectator_joined", ...)`

**`routes/auth.py`** — 2 events:
- `register`: `fire_event("user.events", "user.registered", ...)`
- `login` + `social_login`: `fire_event("user.events", "user.logged_in", ...)`

#### Modified: `docker-compose.dokploy.yml`

Add env var to backend service:

```yaml
REDPANDA_BROKERS: ${REDPANDA_BROKERS:-}
```

In Dokploy environment, set `REDPANDA_BROKERS=redpanda:9092`. The backend container and Redpanda are on the same `dokploy-network`, so internal port 9092 works. When `REDPANDA_BROKERS` is empty (local dev), events are disabled.

### ClickHouse Schema

Three tables + two materialized views:

```sql
-- Main event tables
CREATE TABLE game_events (
    event_id UUID,
    event_type LowCardinality(String),
    game_id UUID,
    room_id UUID,
    user_id UUID,
    game_type LowCardinality(String),
    timestamp DateTime64(3, 'UTC'),
    data String  -- JSON string, parsed at query time
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (game_type, event_type, timestamp)
TTL timestamp + INTERVAL 2 YEAR;

CREATE TABLE user_events (
    event_id UUID,
    event_type LowCardinality(String),
    user_id UUID,
    timestamp DateTime64(3, 'UTC'),
    data String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_type, timestamp)
TTL timestamp + INTERVAL 2 YEAR;

CREATE TABLE room_events (
    event_id UUID,
    event_type LowCardinality(String),
    room_id UUID,
    user_id UUID,
    game_type LowCardinality(String),
    timestamp DateTime64(3, 'UTC'),
    data String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_type, timestamp)
TTL timestamp + INTERVAL 2 YEAR;

-- Pre-aggregated view: games started/finished per day per game type
CREATE MATERIALIZED VIEW games_per_day_mv
ENGINE = SummingMergeTree() ORDER BY (game_type, day)
AS SELECT
    game_type,
    toDate(timestamp) AS day,
    countIf(event_type = 'game.started') AS started,
    countIf(event_type = 'game.finished') AS finished
FROM game_events
GROUP BY game_type, day;

-- Pre-aggregated view: daily active users
CREATE MATERIALIZED VIEW dau_mv
ENGINE = AggregatingMergeTree() ORDER BY (day)
AS SELECT
    toDate(timestamp) AS day,
    uniqState(user_id) AS unique_users
FROM game_events
GROUP BY day;
```

`LowCardinality(String)` is used for columns with few distinct values (event types, game types) — ClickHouse stores them dictionary-encoded for compression and speed.

`MergeTree` partitioned by month with 2-year TTL auto-drops old data.

Materialized views compute aggregates incrementally as data is inserted — no need for batch jobs for basic metrics.

### Event Consumer Service

A standalone Python container in `~/monitoring/consumers/`:

**Files**:
- `Dockerfile` — Python 3.12-slim, installs `confluent-kafka` + `clickhouse-connect`
- `consumer.py` — Main loop
- `requirements.txt` — Dependencies

**Design**:
- Uses `confluent-kafka` (C-backed, production-grade) rather than `aiokafka` — the consumer is a dedicated process, not sharing an event loop
- Subscribes to all 3 topics
- Batch inserts to ClickHouse: accumulates up to 100 events or flushes every 5 seconds (whichever comes first)
- Manual offset commit after successful ClickHouse insert (at-least-once delivery)
- Failed events (3 retries with exponential backoff) go to `dead_letter.events` topic
- Graceful shutdown on SIGTERM

**Why a separate consumer instead of ClickHouse Kafka engine?** The consumer gives more control over error handling, batching, dead-letter routing, and schema evolution. ClickHouse's Kafka engine is simpler but harder to debug when things go wrong.

### DNS Records

| Subdomain | Target | Proxied |
|-----------|--------|---------|
| `redpanda.majlisna.app` | Traefik → redpanda-console:8080 | Yes (Cloudflare) |
| `clickhouse.majlisna.app` | Traefik → clickhouse:8123 | Yes (Cloudflare) |

Both get Traefik labels in the monitoring compose file. Consider adding basic auth or IP allowlisting since these expose internal data.

### Verification Checklist

1. Redpanda Console at `redpanda.majlisna.app` shows 3 topics (`game.events`, `user.events`, `room.events`)
2. Play a game end-to-end → messages appear in `game.events` topic in Console
3. Consumer inserts into ClickHouse → `SELECT count() FROM game_events` returns > 0
4. Stop Redpanda container → game still works normally (events silently lost)
5. Restart Redpanda → consumer catches up from last committed offset
6. Dead letter topic has 0 messages (no consumer failures)

### Files Summary

| Action | File |
|--------|------|
| **Create** | `backend/majlisna/api/services/events.py` |
| **Create** | `~/monitoring/docker-compose.yml` (Redpanda, Console, ClickHouse, Consumer) |
| **Create** | `~/monitoring/consumers/Dockerfile` |
| **Create** | `~/monitoring/consumers/consumer.py` |
| **Create** | `~/monitoring/consumers/requirements.txt` |
| **Create** | `~/monitoring/clickhouse/init.sql` |
| **Modify** | `backend/majlisna/settings.py` — add `redpanda_brokers` |
| **Modify** | `backend/main.py` — producer init/shutdown in lifespan |
| **Modify** | `backend/pyproject.toml` — add `aiokafka` |
| **Modify** | `backend/majlisna/api/routes/undercover.py` — 5 `fire_event()` calls |
| **Modify** | `backend/majlisna/api/routes/codenames.py` — 5 `fire_event()` calls |
| **Modify** | `backend/majlisna/api/routes/wordquiz.py` — 4 `fire_event()` calls |
| **Modify** | `backend/majlisna/api/routes/mcqquiz.py` — 3 `fire_event()` calls |
| **Modify** | `backend/majlisna/api/routes/room.py` — 5 `fire_event()` calls |
| **Modify** | `backend/majlisna/api/routes/auth.py` — 2 `fire_event()` calls |
| **Modify** | `docker-compose.dokploy.yml` — add `REDPANDA_BROKERS` env var |

---

## Phase 2 — Observability (Jaeger + Fluentd)

### Goal

Add distributed tracing (see the full lifecycle of an API request across FastAPI → SQLAlchemy → Redis) and centralized, queryable log storage (replace grepping through Dozzle for historical logs).

### Architecture

```
FastAPI (OpenTelemetry auto-instrumentation) ──OTLP──► Jaeger (traces)

Docker containers (stdout/json-file) ──► Fluentd ──► ClickHouse (queryable logs)
                                              └──► stdout (Dozzle still works)
```

Tracing and log aggregation are independent concerns — either can be deployed without the other.

### Docker Services

| Service | Image | RAM Limit | Exposed Ports | Networks |
|---------|-------|-----------|---------------|----------|
| jaeger | `jaegertracing/all-in-one:1.63` | 512MB | 16686 (UI), 4317 (OTLP gRPC), 4318 (OTLP HTTP) | dokploy-network, internal |
| fluentd | Custom build from `fluent/fluentd:v1.17-1` + ClickHouse output plugin | 256MB | none | internal |

**Jaeger all-in-one** includes collector, query, and UI in a single container. Uses Badger (embedded key-value store) for trace storage by default — no external DB needed. Can optionally be configured to store traces in ClickHouse for longer retention.

**Fluentd** reads Docker JSON log files from a bind-mounted `/var/lib/docker/containers/` directory, parses them, and writes to both ClickHouse (for queryable history) and stdout (so Dozzle continues to work).

### Backend Code Changes

#### Modified: `backend/majlisna/settings.py`

Add one field:

```python
# OpenTelemetry Tracing
otel_exporter_otlp_endpoint: str = ""  # Empty = tracing disabled
```

#### Modified: `backend/majlisna/app.py`

In `_configure_observability()`, after existing Sentry/Logfire setup:

```python
if settings.otel_exporter_otlp_endpoint:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.instrumentation.redis import RedisInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create({"service.name": "majlisna-api"})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    FastAPIInstrumentor.instrument_app(app, excluded_urls="/health,/scalar")
    SQLAlchemyInstrumentor().instrument()
    RedisInstrumentor().instrument()
```

Imports are inside the `if` block because OpenTelemetry packages are optional — they're only installed in production.

#### Modified: `backend/pyproject.toml`

Add dependencies:

```
"opentelemetry-distro[otlp]>=0.48b0"
"opentelemetry-instrumentation-fastapi>=0.48b0"
"opentelemetry-instrumentation-sqlalchemy>=0.48b0"
"opentelemetry-instrumentation-redis>=0.48b0"
```

#### Modified: `docker-compose.dokploy.yml`

Add env var to backend service:

```yaml
OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-}
```

In Dokploy, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4317`.

### ClickHouse Table for Logs

```sql
CREATE TABLE docker_logs (
    timestamp DateTime64(3, 'UTC'),
    container_name LowCardinality(String),
    log_level LowCardinality(String),
    message String,
    source LowCardinality(String)  -- stdout or stderr
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (container_name, timestamp)
TTL timestamp + INTERVAL 30 DAY;
```

30-day retention for logs (much shorter than event data — logs are high-volume, low-value after debugging).

### Fluentd Configuration

`~/monitoring/fluentd/fluent.conf`:

- **Input**: `@type tail`, path `/var/lib/docker/containers/**/*.log`, format `json` (Docker json-file driver)
- **Filter**: Parse container name from file path, extract log level from message (regex for common patterns like `[WARNING]`, `level=error`, Loguru format)
- **Output 1**: `@type clickhouse`, table `docker_logs`, flush interval 5s, buffer 1MB
- **Output 2**: `@type stdout` (preserves Dozzle functionality)

Custom Dockerfile extends `fluent/fluentd:v1.17-1` to install `fluent-plugin-clickhouse`.

### DNS Records

| Subdomain | Target |
|-----------|--------|
| `jaeger.majlisna.app` | Traefik → jaeger:16686 |

### Verification Checklist

1. Make API requests → traces appear in Jaeger UI with spans: HTTP handler → SQLAlchemy query → Redis (if applicable)
2. Query ClickHouse: `SELECT * FROM docker_logs WHERE container_name = 'majlisna-backend' ORDER BY timestamp DESC LIMIT 10` — shows recent backend logs
3. Dozzle still works for live log tailing (Fluentd copies to stdout)
4. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to empty → backend starts fine without tracing
5. Trace IDs propagate through the request lifecycle (visible in Jaeger)

### Files Summary

| Action | File |
|--------|------|
| **Create** | `~/monitoring/fluentd/Dockerfile` |
| **Create** | `~/monitoring/fluentd/fluent.conf` |
| **Modify** | `~/monitoring/docker-compose.yml` — add Jaeger + Fluentd services |
| **Modify** | `~/monitoring/clickhouse/init.sql` — add `docker_logs` table |
| **Modify** | `backend/majlisna/settings.py` — add `otel_exporter_otlp_endpoint` |
| **Modify** | `backend/majlisna/app.py` — OpenTelemetry setup in `_configure_observability()` |
| **Modify** | `backend/pyproject.toml` — add `opentelemetry-*` packages |
| **Modify** | `docker-compose.dokploy.yml` — add `OTEL_EXPORTER_OTLP_ENDPOINT` env var |

---

## Phase 3 — Data Pipeline (Airbyte + Airflow)

### Goal

Replicate PostgreSQL tables into ClickHouse (join event data with user/game/room dimensions), and run scheduled analytical jobs (daily reports, data quality checks, engagement metrics).

### Architecture

```
PostgreSQL (majlisna-db) ──CDC──► Airbyte ──► ClickHouse (replicated tables)

Airflow DAGs:
  ├── daily_game_report       → query ClickHouse → summary tables
  ├── weekly_word_analysis    → difficulty scoring per word
  ├── data_quality_checks     → PG vs CH count comparison → GlitchTip alert if >5% drift
  ├── user_engagement         → DAU/WAU/MAU, retention cohorts (D1/D7/D30)
  └── cleanup                 → drop old CH partitions, vacuum Airflow metadata DB
```

### Docker Services

| Service | Image | RAM Limit | Exposed Ports | Networks |
|---------|-------|-----------|---------------|----------|
| airbyte-server | `airbyte/server` | — | — | internal |
| airbyte-worker | `airbyte/worker` | — | — | internal |
| airbyte-webapp | `airbyte/webapp` | — | 31900 | dokploy-network, internal |
| airbyte-temporal | `airbyte/temporal` | — | — | internal |
| airbyte-db | `postgres:16-alpine` | 256MB | — | internal |
| airflow-webserver | `apache/airflow:2.10-python3.12` | 512MB | 31950 | dokploy-network, internal |
| airflow-scheduler | `apache/airflow:2.10-python3.12` | 512MB | — | internal |
| airflow-metadata-db | `postgres:16-alpine` | 128MB | — | internal |

Total Airbyte stack: ~3GB. Total Airflow: ~1.1GB.

**Airbyte** handles the ELT (Extract-Load-Transform) from PostgreSQL to ClickHouse. Uses CDC (Change Data Capture) via PostgreSQL logical replication for incremental syncs — only changed rows are transferred.

**Airflow** runs scheduled Python DAGs using the LocalExecutor (no Celery/Kubernetes needed for this scale).

### Airbyte Configuration

- **Source**: PostgreSQL CDC connector, pointing at `majlisna-db:5432`
- **Tables synced**: `user`, `game`, `room`, `user_stats`, `user_achievement`, `room_user_link`
- **Destination**: ClickHouse connector, pointing at `clickhouse:8123`
- **Sync schedule**: Every 6 hours
- **Sync mode**: Incremental with CDC (deduplication in ClickHouse via ReplacingMergeTree)

This enables queries like "join game events with user data" — e.g., "average game duration by user registration month" or "which users have the highest win rate in Undercover".

### Airflow DAGs

All DAGs in `~/monitoring/airflow/dags/`:

**1. `daily_game_report.py`** — runs daily at 06:00 UTC
- Queries ClickHouse for yesterday's game stats: games per type, unique players, avg duration, most popular words
- Inserts into `daily_reports` ClickHouse table
- Could send a summary to a Slack webhook or email in the future

**2. `weekly_word_analysis.py`** — runs every Monday
- Undercover: word elimination rates (how often each term pair leads to correct elimination)
- Word Quiz: per-word answer accuracy, average hint number needed, average answer time
- MCQ Quiz: per-question accuracy, most-missed questions
- Writes to `word_analytics` table for game design decisions

**3. `data_quality_checks.py`** — runs daily at 07:00 UTC
- Compares PostgreSQL game count vs ClickHouse event count
- Checks for orphaned events (events referencing non-existent games/users)
- If discrepancy > 5%, sends alert to GlitchTip via Sentry SDK

**4. `user_engagement.py`** — runs daily
- Computes DAU/WAU/MAU from event data
- Builds retention cohorts: D1, D7, D30 (% of users who return after N days)
- Session frequency distribution
- Writes to `engagement_metrics` table

**5. `cleanup.py`** — runs weekly
- Drops ClickHouse partitions beyond TTL (safety net if TTL doesn't fire)
- Cleans dead letter topic messages
- `VACUUM` on Airflow metadata DB

### DNS Records

| Subdomain | Target |
|-----------|--------|
| `airbyte.majlisna.app` | Traefik → airbyte-webapp |
| `airflow.majlisna.app` | Traefik → airflow-webserver |

### Verification Checklist

1. Airbyte sync completes → ClickHouse has `_airbyte_raw_user`, `_airbyte_raw_game`, etc. tables
2. Cross-source query works: `SELECT ge.event_type, u.username FROM game_events ge JOIN _airbyte_raw_user u ON ge.user_id = u.id`
3. Manually trigger `daily_game_report` DAG → `daily_reports` table populated
4. All 5 DAGs show green (success) in Airflow UI
5. Data quality check DAG runs without alerting (counts match within 5%)

### Files Summary

| Action | File |
|--------|------|
| **Create** | `~/monitoring/airflow/dags/daily_game_report.py` |
| **Create** | `~/monitoring/airflow/dags/weekly_word_analysis.py` |
| **Create** | `~/monitoring/airflow/dags/data_quality_checks.py` |
| **Create** | `~/monitoring/airflow/dags/user_engagement.py` |
| **Create** | `~/monitoring/airflow/dags/cleanup.py` |
| **Modify** | `~/monitoring/docker-compose.yml` — add Airbyte + Airflow services |

---

## Phase 4 — Stream Processing (Flink)

### Goal

Process the Redpanda event stream in real-time for live leaderboards, activity dashboards, anomaly detection, and continuous word difficulty scoring.

### Architecture

```
Redpanda topics ──► Flink (JobManager + TaskManager) ──► ClickHouse (aggregated metrics)
                                                     └──► Redis (live leaderboard cache)
```

### Docker Services

| Service | Image | RAM Limit | Exposed Ports | Networks |
|---------|-------|-----------|---------------|----------|
| flink-jobmanager | `flink:1.20-java17` | 1GB | 18081 (Web UI) | dokploy-network, internal |
| flink-taskmanager | `flink:1.20-java17` | 2GB | none | internal |

Flink runs in session mode — one long-running cluster with multiple jobs submitted to it.

### Flink Jobs

**1. Live Leaderboard** (Flink SQL)
- Source: `game.events` topic, filter `event_type = 'game.finished'`
- 1-minute tumbling window
- Counts wins per user per game type
- Sinks to:
  - Redis sorted sets (`leaderboard:undercover`, `leaderboard:codenames`, etc.) for real-time reads
  - ClickHouse `leaderboard_history` table for historical trends

**2. Game Activity Dashboard** (Flink SQL)
- Real-time metrics: active games (started but not finished in last hour), players online (distinct user_ids in last 5 min), events/second
- 10-second tumbling window
- Sinks to ClickHouse `realtime_activity` table
- Can power a widget on Homepage or a Grafana dashboard

**3. Anomaly Detection** (PyFlink)
- 5-minute sliding window over `game.events`
- Detects:
  - Rapid-fire votes (< 1 second between votes from same user)
  - Suspicious win streaks (10+ consecutive wins)
  - Room join/leave abuse (> 20 joins in 5 minutes)
- Alerts sent to GlitchTip via HTTP sink

**4. Word Difficulty Scoring** (Flink SQL)
- Continuously computes per-word metrics over a sliding window of the last 100 games:
  - Correct rate (answers/attempts)
  - Average hint number when answered correctly
  - Average answer time
- Updates ClickHouse `word_difficulty` table
- Useful for auto-balancing quiz difficulty

Jobs can be written in Flink SQL (declarative, easier for aggregations) or PyFlink (Python UDFs for complex logic). Submitted via Flink REST API (`POST /jars/:jarid/run` or SQL statements via SQL gateway).

### DNS Records

| Subdomain | Target |
|-----------|--------|
| `flink.majlisna.app` | Traefik → flink-jobmanager:8081 |

### Verification Checklist

1. Submit leaderboard job → play a few games → `SELECT * FROM leaderboard_history` shows data
2. `redis-cli ZREVRANGE leaderboard:undercover 0 9 WITHSCORES` shows top 10
3. Flink UI at `flink.majlisna.app` shows all 4 jobs running with checkpoint status
4. Stop Redpanda briefly → restart → Flink recovers from last checkpoint, no data loss
5. Activity dashboard updates within 10 seconds of game actions

### Files Summary

| Action | File |
|--------|------|
| **Create** | `~/monitoring/flink-jobs/leaderboard.sql` |
| **Create** | `~/monitoring/flink-jobs/activity_dashboard.sql` |
| **Create** | `~/monitoring/flink-jobs/anomaly_detection.py` |
| **Create** | `~/monitoring/flink-jobs/word_difficulty.sql` |
| **Create** | `~/monitoring/flink-jobs/submit_jobs.sh` — script to submit all jobs via Flink REST API |
| **Modify** | `~/monitoring/docker-compose.yml` — add Flink services |

---

## Phase Dependencies

```
Phase 1 (Redpanda + ClickHouse) ◄── FOUNDATION — everything depends on this
    │
    ├── Phase 2 (Jaeger + Fluentd) — independent, uses ClickHouse for logs
    │                                  (can run in parallel with Phase 1)
    │
    ├── Phase 3 (Airbyte + Airflow) — requires ClickHouse as destination
    │                                   (requires Phase 1 complete)
    │
    └── Phase 4 (Flink)             — requires Redpanda (source) + ClickHouse (sink)
                                       (requires Phase 1 complete, benefits from Phase 3 data)
```

Phase 2 can be implemented in parallel with Phase 1 since Jaeger is self-contained and Fluentd only needs ClickHouse for log storage.

## RAM Budget

| Phase | Services | Estimated RAM |
|-------|----------|---------------|
| Current | App + Monitoring stack | ~7 GB |
| Phase 1 | Redpanda (512M), Console (128M), ClickHouse (1G), Consumer (256M) | ~1.9 GB |
| Phase 2 | Jaeger (512M), Fluentd (256M) | ~0.8 GB |
| Phase 3 | Airbyte stack (~3G), Airflow stack (~1G), metadata PG (128M) | ~4.1 GB |
| Phase 4 | Flink JobManager (1G), TaskManager (2G) | ~3.0 GB |
| **Total** | | **~16.8 GB / 24 GB** |

**Buffer**: ~7.2 GB free after all 4 phases. If memory gets tight:
- Airbyte CLI mode (no webapp/temporal) saves ~2 GB
- Flink TaskManager can be reduced to 1 GB
- ClickHouse `max_memory_usage` can be capped
- Jaeger can use ClickHouse for trace storage instead of Badger (saves Jaeger memory)

## Implementation Order

1. **Phase 1** first — foundation for everything else
2. **Phase 2** next (or in parallel) — quick observability win
3. **Phase 3** after Phase 1 is stable and producing events — adds historical analytics
4. **Phase 4** last — most advanced, requires Phase 1 maturity and real event volume

## Complete File Inventory

### New Files (to create)

```
backend/majlisna/api/services/events.py          # Event producer module

~/monitoring/docker-compose.yml              # All infrastructure services
~/monitoring/.env                            # Shared passwords/config

~/monitoring/consumers/Dockerfile            # Consumer container
~/monitoring/consumers/consumer.py           # Kafka→ClickHouse consumer
~/monitoring/consumers/requirements.txt      # confluent-kafka, clickhouse-connect

~/monitoring/clickhouse/init.sql             # All ClickHouse table/view DDL

~/monitoring/fluentd/Dockerfile              # Fluentd + ClickHouse plugin
~/monitoring/fluentd/fluent.conf             # Fluentd pipeline config

~/monitoring/airflow/dags/daily_game_report.py
~/monitoring/airflow/dags/weekly_word_analysis.py
~/monitoring/airflow/dags/data_quality_checks.py
~/monitoring/airflow/dags/user_engagement.py
~/monitoring/airflow/dags/cleanup.py

~/monitoring/flink-jobs/leaderboard.sql
~/monitoring/flink-jobs/activity_dashboard.sql
~/monitoring/flink-jobs/anomaly_detection.py
~/monitoring/flink-jobs/word_difficulty.sql
~/monitoring/flink-jobs/submit_jobs.sh
```

### Existing Files (to modify)

```
backend/majlisna/settings.py                     # +redpanda_brokers, +otel_exporter_otlp_endpoint
backend/main.py                             # +producer init/shutdown in lifespan
backend/pyproject.toml                      # +aiokafka, +opentelemetry-*
backend/majlisna/app.py                          # +OpenTelemetry setup

backend/majlisna/api/routes/undercover.py        # +5 fire_event() calls
backend/majlisna/api/routes/codenames.py         # +5 fire_event() calls
backend/majlisna/api/routes/wordquiz.py          # +4 fire_event() calls
backend/majlisna/api/routes/mcqquiz.py           # +3 fire_event() calls
backend/majlisna/api/routes/room.py              # +5 fire_event() calls
backend/majlisna/api/routes/auth.py              # +2 fire_event() calls

docker-compose.dokploy.yml                  # +REDPANDA_BROKERS, +OTEL_EXPORTER_OTLP_ENDPOINT env vars
~/monitoring/homepage/services.yaml          # +dashboard cards for new tools
```
