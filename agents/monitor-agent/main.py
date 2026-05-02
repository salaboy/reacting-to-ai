import os
import logging
from datetime import datetime
from pathlib import Path
from threading import Lock

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("monitor-agent")

app = FastAPI(title="Monitor Agent")

FIXER_AGENT_URL = os.getenv("FIXER_AGENT_URL", "http://fixer-agent.default.svc.cluster.local:8081")


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
            alert_dict["receivedAt"] = datetime.utcnow().isoformat() + "Z"

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
            "  [%s] %s — %s",
            alert.status.upper(),
            alert.labels.get("alertname", "unknown"),
            alert.annotations.get("summary", "no summary"),
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
