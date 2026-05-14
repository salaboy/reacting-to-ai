import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import psycopg2
import requests
from fastapi import FastAPI, HTTPException, Query
from pgvector.psycopg2 import register_vector
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

from telemetry import init_telemetry, instrument_fastapi

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("knowledge-agent")

init_telemetry("knowledge-agent")

app = FastAPI(title="Knowledge Agent")
instrument_fastapi(app)

DB_URL = os.getenv(
    "KNOWLEDGE_DB_URL",
    "postgresql://knowledge:knowledge@localhost:5432/knowledge",
)
JAEGER_QUERY_URL = os.getenv(
    "JAEGER_QUERY_URL",
    "http://jaeger-query.default.svc.cluster.local:16686",
)
JAEGER_ENRICHMENT_ENABLED = os.getenv("JAEGER_ENRICHMENT_ENABLED", "false").lower() == "true"
HF_HOME = os.getenv("HF_HOME", "/data/models")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

_model: Optional[SentenceTransformer] = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        logger.info("Loading embedding model: %s", EMBEDDING_MODEL)
        _model = SentenceTransformer(EMBEDDING_MODEL)
        logger.info("Embedding model loaded")
    return _model


def get_conn():
    conn = psycopg2.connect(DB_URL)
    register_vector(conn)
    return conn


def init_db():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS investigations (
                    id               TEXT PRIMARY KEY,
                    alert_name       TEXT NOT NULL,
                    description      TEXT,
                    labels           JSONB,
                    annotations      JSONB,
                    status           TEXT,
                    pr_url           TEXT,
                    issue_url        TEXT,
                    analysis         TEXT,
                    changed_files    TEXT[],
                    steps            JSONB,
                    trace_context    JSONB,
                    embedding        vector(384),
                    created_at       TIMESTAMPTZ,
                    completed_at     TIMESTAMPTZ
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS evaluations (
                    id               TEXT PRIMARY KEY,
                    investigation_id TEXT REFERENCES investigations(id),
                    url              TEXT,
                    description      TEXT,
                    passed           BOOLEAN,
                    verdict_summary  TEXT,
                    analysis         TEXT,
                    steps            JSONB,
                    status           TEXT,
                    issue_url        TEXT,
                    embedding        vector(384),
                    created_at       TIMESTAMPTZ,
                    completed_at     TIMESTAMPTZ
                );
            """)
            # IVFFlat indexes — only useful once there are enough rows; safe to create on empty table
            cur.execute("""
                CREATE INDEX IF NOT EXISTS investigations_embedding_idx
                ON investigations USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 10);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS evaluations_embedding_idx
                ON evaluations USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 10);
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS investigations_alert_name_idx ON investigations (alert_name);")
            cur.execute("CREATE INDEX IF NOT EXISTS investigations_status_idx ON investigations (status);")
        conn.commit()
        logger.info("Database schema initialized")
    finally:
        conn.close()


def fetch_trace_context(trace_ids: list[str]) -> dict:
    """Fetch span details from Jaeger for each trace ID and extract key error context."""
    if not JAEGER_ENRICHMENT_ENABLED or not trace_ids:
        return {}

    context = {}
    for trace_id in trace_ids:
        try:
            resp = requests.get(
                f"{JAEGER_QUERY_URL}/api/traces/{trace_id}",
                timeout=5,
            )
            if resp.status_code != 200:
                continue
            data = resp.json()
            spans = []
            for trace_data in data.get("data", []):
                for span in trace_data.get("spans", []):
                    entry = {
                        "operation": span.get("operationName", ""),
                        "duration_us": span.get("duration", 0),
                    }
                    errors = []
                    for tag in span.get("tags", []):
                        if tag.get("key") in ("error", "error.message", "exception.message"):
                            errors.append(str(tag.get("value", "")))
                        if tag.get("key") == "http.status_code":
                            entry["http_status"] = tag.get("value")
                    for log in span.get("logs", []):
                        for field in log.get("fields", []):
                            if field.get("key") in ("error", "message", "event") and field.get("value"):
                                errors.append(str(field["value"]))
                    if errors:
                        entry["errors"] = errors
                        spans.append(entry)
            if spans:
                context[trace_id] = spans
        except Exception as e:
            logger.warning("Failed to fetch trace %s from Jaeger: %s", trace_id, e)

    return context


def build_investigation_text(inv: dict, trace_context: dict) -> str:
    labels = " ".join(f"{k}={v}" for k, v in (inv.get("labels") or {}).items())
    traces = inv.get("related_traces") or []
    trace_lines = []
    for t in traces:
        line = f"  service={t.get('serviceName','')} op={t.get('operationName','')} duration={t.get('duration',0)}us"
        enriched = trace_context.get(t.get("traceID", ""), [])
        for span in enriched[:3]:
            if span.get("errors"):
                line += f" errors={span['errors'][:2]}"
        trace_lines.append(line)

    changed = ", ".join(inv.get("changed_files") or [])
    analysis = (inv.get("analysis") or "")[:1500]

    return (
        f"Alert: {inv.get('alert_name', '')}\n"
        f"Description: {inv.get('description', '')}\n"
        f"Labels: {labels}\n"
        f"Traces:\n" + "\n".join(trace_lines) + "\n"
        f"Root cause analysis: {analysis}\n"
        f"Changed files: {changed}\n"
        f"Outcome: {inv.get('status', '')}"
    )


def build_evaluation_text(ev: dict) -> str:
    analysis = (ev.get("analysis") or "")[:2000]
    return (
        f"URL: {ev.get('url', '')}\n"
        f"Description: {ev.get('description', '')}\n"
        f"Verdict: {'passed' if ev.get('passed') else 'failed'}\n"
        f"Summary: {ev.get('summary') or ev.get('verdict_summary', '')}\n"
        f"Analysis: {analysis}"
    )


def format_results_as_text(rows: list[dict]) -> str:
    if not rows:
        return ""
    parts = []
    for i, row in enumerate(rows, 1):
        sim = row.get("similarity", 0)
        ev_outcome = ""
        if row.get("evaluation_passed") is not None:
            ev_outcome = " — evaluation " + ("passed" if row["evaluation_passed"] else "failed")
        parts.append(
            f"Case {i} (similarity: {sim:.2f}):\n"
            f"  Alert: {row.get('alert_name', '')}\n"
            f"  Root cause: {(row.get('analysis') or '')[:300]}\n"
            f"  Fix applied to: {', '.join(row.get('changed_files') or [])}\n"
            f"  Outcome: {row.get('status', '')}{ev_outcome}"
        )
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
def on_startup():
    init_db()
    get_model()  # warm up the embedding model


# ---------------------------------------------------------------------------
# Index endpoints
# ---------------------------------------------------------------------------

class IndexInvestigationRequest(BaseModel):
    id: str
    alert_name: str
    description: str = ""
    labels: dict = {}
    annotations: dict = {}
    status: str = ""
    pr_url: str = ""
    issue_url: str = ""
    analysis: str = ""
    changed_files: list[str] = []
    steps: list = []
    related_traces: list[dict] = []
    createdAt: str = ""
    completedAt: str = ""


class IndexEvaluationRequest(BaseModel):
    id: str
    investigation_id: Optional[str] = None
    url: str = ""
    description: str = ""
    passed: Optional[bool] = None
    summary: str = ""
    analysis: str = ""
    steps: list = []
    status: str = ""
    issue_url: str = ""
    createdAt: str = ""
    completedAt: str = ""


@app.post("/index/investigation")
def index_investigation(payload: IndexInvestigationRequest):
    trace_ids = [t.get("traceID", "") for t in payload.related_traces if t.get("traceID")]
    trace_context = fetch_trace_context(trace_ids)

    doc_text = build_investigation_text(payload.model_dump(), trace_context)
    embedding = get_model().encode(doc_text).tolist()

    def _parse_ts(s: str):
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO investigations
                    (id, alert_name, description, labels, annotations, status,
                     pr_url, issue_url, analysis, changed_files, steps,
                     trace_context, embedding, created_at, completed_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO UPDATE SET
                    status=EXCLUDED.status,
                    pr_url=EXCLUDED.pr_url,
                    issue_url=EXCLUDED.issue_url,
                    analysis=EXCLUDED.analysis,
                    changed_files=EXCLUDED.changed_files,
                    steps=EXCLUDED.steps,
                    trace_context=EXCLUDED.trace_context,
                    embedding=EXCLUDED.embedding,
                    completed_at=EXCLUDED.completed_at
            """, (
                payload.id,
                payload.alert_name,
                payload.description,
                json.dumps(payload.labels),
                json.dumps(payload.annotations),
                payload.status,
                payload.pr_url,
                payload.issue_url,
                payload.analysis,
                payload.changed_files,
                json.dumps(payload.steps),
                json.dumps(trace_context) if trace_context else None,
                embedding,
                _parse_ts(payload.createdAt),
                _parse_ts(payload.completedAt),
            ))
        conn.commit()
    finally:
        conn.close()

    logger.info("Indexed investigation %s (status=%s)", payload.id, payload.status)
    return {"status": "indexed", "doc_id": payload.id}


@app.post("/index/evaluation")
def index_evaluation(payload: IndexEvaluationRequest):
    doc_text = build_evaluation_text(payload.model_dump())
    embedding = get_model().encode(doc_text).tolist()

    def _parse_ts(s: str):
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # If investigation_id is given, verify it exists (skip FK error on unknown IDs)
            if payload.investigation_id:
                cur.execute("SELECT 1 FROM investigations WHERE id=%s", (payload.investigation_id,))
                if not cur.fetchone():
                    logger.warning(
                        "Evaluation %s references unknown investigation %s — storing without FK",
                        payload.id, payload.investigation_id,
                    )
                    payload = payload.model_copy(update={"investigation_id": None})

            cur.execute("""
                INSERT INTO evaluations
                    (id, investigation_id, url, description, passed,
                     verdict_summary, analysis, steps, status,
                     issue_url, embedding, created_at, completed_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO UPDATE SET
                    passed=EXCLUDED.passed,
                    verdict_summary=EXCLUDED.verdict_summary,
                    analysis=EXCLUDED.analysis,
                    steps=EXCLUDED.steps,
                    status=EXCLUDED.status,
                    issue_url=EXCLUDED.issue_url,
                    embedding=EXCLUDED.embedding,
                    completed_at=EXCLUDED.completed_at
            """, (
                payload.id,
                payload.investigation_id,
                payload.url,
                payload.description,
                payload.passed,
                payload.summary,
                payload.analysis,
                json.dumps(payload.steps),
                payload.status,
                payload.issue_url,
                embedding,
                _parse_ts(payload.createdAt),
                _parse_ts(payload.completedAt),
            ))
        conn.commit()
    finally:
        conn.close()

    logger.info("Indexed evaluation %s (passed=%s)", payload.id, payload.passed)
    return {"status": "indexed", "doc_id": payload.id}


# ---------------------------------------------------------------------------
# Query endpoint
# ---------------------------------------------------------------------------

@app.get("/query")
def query_knowledge(
    text: str = Query(..., description="Text to search for similar past cases"),
    k: int = Query(3, ge=1, le=10),
):
    embedding = get_model().encode(text).tolist()

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT i.id, i.alert_name, i.analysis, i.changed_files, i.status,
                       i.pr_url, i.labels,
                       1 - (i.embedding <=> %s::vector) AS similarity,
                       (
                           SELECT e.passed FROM evaluations e
                           WHERE e.investigation_id = i.id
                           ORDER BY e.created_at DESC LIMIT 1
                       ) AS evaluation_passed
                FROM investigations i
                WHERE i.status != 'error'
                  AND i.embedding IS NOT NULL
                ORDER BY i.embedding <=> %s::vector
                LIMIT %s
            """, (embedding, embedding, k))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()

    return {
        "results": [
            {
                "text": format_results_as_text([row]),
                "score": float(row["similarity"]),
                "metadata": {
                    "id": row["id"],
                    "alert_name": row["alert_name"],
                    "status": row["status"],
                    "pr_url": row["pr_url"],
                    "evaluation_passed": row["evaluation_passed"],
                },
            }
            for row in rows
            if row["similarity"] > 0.3
        ]
    }


# ---------------------------------------------------------------------------
# List endpoints
# ---------------------------------------------------------------------------

@app.get("/api/investigations")
def list_investigations(limit: int = Query(50, ge=1, le=200)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, alert_name, description, status, pr_url, issue_url,
                       changed_files, created_at, completed_at
                FROM investigations
                ORDER BY created_at DESC
                LIMIT %s
            """, (limit,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()
    for row in rows:
        for key in ("created_at", "completed_at"):
            if row[key]:
                row[key] = row[key].isoformat()
    return rows


@app.get("/api/evaluations")
def list_evaluations(limit: int = Query(50, ge=1, le=200)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, investigation_id, url, description, passed,
                       verdict_summary, status, issue_url, created_at, completed_at
                FROM evaluations
                ORDER BY created_at DESC
                LIMIT %s
            """, (limit,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        conn.close()
    for row in rows:
        for key in ("created_at", "completed_at"):
            if row[key]:
                row[key] = row[key].isoformat()
    return rows


@app.get("/health")
def health():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM investigations")
            inv_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM evaluations")
            ev_count = cur.fetchone()[0]
    finally:
        conn.close()
    return {"status": "ok", "counts": {"investigations": inv_count, "evaluations": ev_count}}
