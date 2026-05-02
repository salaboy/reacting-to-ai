import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

import requests as http_client
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("monitor-agent")

app = FastAPI(title="Monitor Agent")

FIXER_AGENT_URL = os.getenv("FIXER_AGENT_URL", "http://fixer-agent.default.svc.cluster.local:8081")
JAEGER_QUERY_URL = os.getenv("JAEGER_QUERY_URL", "http://jaeger-query.default.svc.cluster.local:16686")
JAEGER_BASE_PATH = os.getenv("JAEGER_BASE_PATH", "/jaeger/ui")
JAEGER_EXTERNAL_URL = os.getenv("JAEGER_EXTERNAL_URL", "http://localhost/jaeger/ui")


class Alert(BaseModel):
    status: str
    labels: dict = {}
    annotations: dict = {}
    startsAt: str = ""
    endsAt: str = ""
    fingerprint: str = ""


class AlertmanagerWebhook(BaseModel):
    version: str = ""
    groupKey: str = ""
    status: str = ""
    receiver: str = ""
    alerts: list[Alert] = []


alerts_lock = Lock()
alerts: list[dict] = []
MAX_ALERTS = 100


def fetch_traces_for_alert(alert: Alert) -> list[dict]:
    """Query Jaeger for error traces related to a firing alert."""
    service_name = alert.labels.get("service_name", "")
    if not service_name:
        return []

    try:
        start_time = datetime.fromisoformat(alert.startsAt.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        start_time = datetime.now(timezone.utc)

    # Look back 5 minutes before the alert started
    lookback_us = 5 * 60 * 1_000_000
    start_us = int(start_time.timestamp() * 1_000_000) - lookback_us
    end_us = int(datetime.now(timezone.utc).timestamp() * 1_000_000)

    params = {
        "service": service_name,
        "tags": '{"error":"true"}',
        "start": start_us,
        "end": end_us,
        "limit": 10,
    }

    try:
        resp = http_client.get(
            f"{JAEGER_QUERY_URL}{JAEGER_BASE_PATH}/api/traces",
            params=params,
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])

        traces = []
        for trace in data:
            trace_id = trace.get("traceID", "")
            spans = trace.get("spans", [])
            if not spans:
                continue

            root_span = spans[0]
            traces.append({
                "traceID": trace_id,
                "operationName": root_span.get("operationName", ""),
                "serviceName": service_name,
                "duration": root_span.get("duration", 0),
                "startTime": root_span.get("startTime", 0),
                "spanCount": len(spans),
                "jaegerUrl": f"{JAEGER_EXTERNAL_URL}/trace/{trace_id}",
            })

        logger.info("Found %d error trace(s) in Jaeger for service %s", len(traces), service_name)
        return traces

    except Exception as e:
        logger.warning("Failed to query Jaeger for traces: %s", e)
        return []


@app.post("/api/webhook/alerts")
async def receive_alerts(payload: AlertmanagerWebhook):
    logger.info(
        "Received %d alert(s) from Alertmanager (status: %s, receiver: %s)",
        len(payload.alerts),
        payload.status,
        payload.receiver,
    )

    with alerts_lock:
        for alert in payload.alerts:
            alert_dict = alert.model_dump()
            alert_dict["receivedAt"] = datetime.now(timezone.utc).isoformat()

            # Fetch related traces from Jaeger for firing alerts
            if alert.status == "firing":
                alert_dict["relatedTraces"] = fetch_traces_for_alert(alert)
            else:
                alert_dict["relatedTraces"] = []

            # Update existing alert by fingerprint or append
            found = False
            for i, existing in enumerate(alerts):
                if existing["fingerprint"] == alert.fingerprint:
                    alerts[i] = alert_dict
                    found = True
                    break
            if not found:
                alerts.append(alert_dict)

        # Trim to max size
        if len(alerts) > MAX_ALERTS:
            del alerts[: len(alerts) - MAX_ALERTS]

    for alert in payload.alerts:
        logger.info(
            "  [%s] %s — %s (service: %s)",
            alert.status.upper(),
            alert.labels.get("alertname", "unknown"),
            alert.annotations.get("summary", "no summary"),
            alert.labels.get("service_name", "unknown"),
        )

    return {"status": "ok", "received": len(payload.alerts)}


@app.get("/api/alerts")
async def get_alerts():
    with alerts_lock:
        return list(alerts)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve the React frontend
static_dir = Path(__file__).parent / "static"
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
