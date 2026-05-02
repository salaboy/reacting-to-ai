import os
import shutil
import subprocess
import tempfile
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread, Lock

import requests
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fixer-agent")

app = FastAPI(title="Fixer Agent")

REPO_URL = os.getenv("REPO_URL", "https://github.com/salaboy/reacting-to-ai.git")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "")

SYSTEM_PROMPT = (
    "You are a code fixer agent. You receive alerts from a monitoring system "
    "along with related error traces, and your job is to investigate the application "
    "source code, find the root cause, and apply a minimal fix.\n\n"
    "Follow these steps:\n"
    "1. Review the alert details and related traces provided\n"
    "2. List the repository files to understand the project structure\n"
    "3. Read the relevant source files (start with main application files)\n"
    "4. Search for patterns related to the error described in the alert and traces\n"
    "5. Determine the root cause of the issue\n"
    "6. Apply a fix using the apply_fix tool — provide the complete updated file content\n\n"
    "Be precise and minimal in your fixes. Only change what is necessary to resolve the alert. "
    "Do not refactor, add comments, or make unrelated improvements."
)


class TraceInfo(BaseModel):
    traceID: str = ""
    operationName: str = ""
    serviceName: str = ""
    duration: int = 0
    startTime: int = 0
    spanCount: int = 0
    jaegerUrl: str = ""


class FixRequest(BaseModel):
    alert_name: str
    description: str
    labels: dict = {}
    annotations: dict = {}
    related_traces: list[TraceInfo] = []


investigations_lock = Lock()
investigations: list[dict] = []
MAX_INVESTIGATIONS = 50


def create_tools(repo_dir: str):
    @tool
    def list_files(directory: str = ".") -> str:
        """List all files in the repository. Use '.' for the root or provide a subdirectory path."""
        target = os.path.normpath(os.path.join(repo_dir, directory))
        if not target.startswith(repo_dir):
            return "Error: path outside repository"
        result = []
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "dist", "__pycache__")]
            for f in files:
                rel = os.path.relpath(os.path.join(root, f), repo_dir)
                result.append(rel)
        return "\n".join(sorted(result)) if result else "No files found."

    @tool
    def read_file(path: str) -> str:
        """Read the contents of a file in the repository."""
        full_path = os.path.normpath(os.path.join(repo_dir, path))
        if not full_path.startswith(repo_dir):
            return "Error: path outside repository"
        try:
            with open(full_path, "r") as f:
                return f.read()
        except FileNotFoundError:
            return f"Error: file {path} not found"

    @tool
    def search_code(pattern: str) -> str:
        """Search for a text pattern across source files in the repository. Returns matching lines with file paths and line numbers."""
        result = subprocess.run(
            [
                "grep", "-rn",
                "--include=*.go", "--include=*.py", "--include=*.jsx",
                "--include=*.js", "--include=*.yaml", "--include=*.json",
                "--include=*.css",
                pattern, ".",
            ],
            cwd=repo_dir,
            capture_output=True,
            text=True,
        )
        output = result.stdout.strip()
        return output if output else "No matches found."

    @tool
    def apply_fix(path: str, content: str) -> str:
        """Write new content to a file to apply a fix. Provide the full file content."""
        full_path = os.path.normpath(os.path.join(repo_dir, path))
        if not full_path.startswith(repo_dir):
            return "Error: path outside repository"
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
        return f"File {path} updated successfully."

    return [list_files, read_file, search_code, apply_fix]


def create_agent(tools):
    kwargs = {"api_key": ANTHROPIC_API_KEY, "max_tokens": 4096}
    if ANTHROPIC_MODEL:
        kwargs["model"] = ANTHROPIC_MODEL
    llm = ChatAnthropic(**kwargs)
    logger.info("Using model: %s", llm.model)
    return create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)


def clone_repo(target_dir: str):
    if GITHUB_TOKEN:
        auth_url = REPO_URL.replace("https://", f"https://x-access-token:{GITHUB_TOKEN}@")
    else:
        auth_url = REPO_URL
    subprocess.run(["git", "clone", auth_url, target_dir], check=True, capture_output=True)


def create_pr(repo_dir: str, branch: str, alert_name: str, analysis: str) -> str:
    parts = REPO_URL.rstrip("/").removesuffix(".git").split("/")
    owner, repo = parts[-2], parts[-1]

    subprocess.run(["git", "checkout", "-b", branch], cwd=repo_dir, check=True, capture_output=True)
    subprocess.run(["git", "add", "-A"], cwd=repo_dir, check=True, capture_output=True)

    commit_msg = f"fix: address {alert_name} alert"
    subprocess.run(
        ["git", "commit", "-m", commit_msg],
        cwd=repo_dir, check=True, capture_output=True,
    )
    subprocess.run(["git", "push", "origin", branch], cwd=repo_dir, check=True, capture_output=True)

    pr_body = f"## Alert\n\n**{alert_name}**\n\n## Analysis\n\n{analysis}\n\n---\nGenerated by fixer-agent"
    resp = requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/pulls",
        headers={
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
        },
        json={
            "title": commit_msg,
            "body": pr_body,
            "head": branch,
            "base": "main",
        },
    )
    resp.raise_for_status()
    return resp.json().get("html_url", "")


def update_investigation(investigation_id: str, updates: dict):
    with investigations_lock:
        for inv in investigations:
            if inv["id"] == investigation_id:
                inv.update(updates)
                break


def run_investigation(investigation_id: str, payload: FixRequest):
    update_investigation(investigation_id, {"status": "cloning"})

    repo_dir = tempfile.mkdtemp(prefix="fixer-")
    try:
        clone_repo(repo_dir)
        logger.info("Cloned repository to %s", repo_dir)
        update_investigation(investigation_id, {"status": "investigating"})

        tools = create_tools(repo_dir)
        agent = create_agent(tools)

        traces_context = ""
        if payload.related_traces:
            trace_lines = []
            for t in payload.related_traces:
                trace_lines.append(
                    f"  - TraceID: {t.traceID}, Operation: {t.operationName}, "
                    f"Service: {t.serviceName}, Duration: {t.duration}us, "
                    f"Spans: {t.spanCount}"
                )
            traces_context = "\n\nRelated error traces:\n" + "\n".join(trace_lines)

        result = agent.invoke({
            "messages": [
                {
                    "role": "user",
                    "content": (
                        f"An alert has fired and needs investigation:\n\n"
                        f"Alert name: {payload.alert_name}\n"
                        f"Description: {payload.description}\n"
                        f"Labels: {payload.labels}\n"
                        f"Annotations: {payload.annotations}"
                        f"{traces_context}\n\n"
                        f"Investigate the application code, find the root cause, and apply a fix."
                    ),
                }
            ]
        })

        analysis = result["messages"][-1].content

        diff = subprocess.run(["git", "diff"], cwd=repo_dir, capture_output=True, text=True)
        if not diff.stdout.strip():
            logger.info("Agent found no code changes to apply")
            update_investigation(investigation_id, {
                "status": "no_fix_needed",
                "analysis": analysis,
                "completedAt": datetime.now(timezone.utc).isoformat(),
            })
            return

        update_investigation(investigation_id, {"status": "creating_pr"})
        branch = f"fix/{payload.alert_name.lower()}-{uuid.uuid4().hex[:8]}"
        pr_url = create_pr(repo_dir, branch, payload.alert_name, analysis)
        logger.info("Pull request created: %s", pr_url)

        update_investigation(investigation_id, {
            "status": "pr_created",
            "analysis": analysis,
            "pr_url": pr_url,
            "completedAt": datetime.now(timezone.utc).isoformat(),
        })

    except Exception as e:
        logger.exception("Error processing alert")
        update_investigation(investigation_id, {
            "status": "error",
            "error": str(e),
            "completedAt": datetime.now(timezone.utc).isoformat(),
        })
    finally:
        shutil.rmtree(repo_dir, ignore_errors=True)


@app.post("/fix")
async def fix_alert(payload: FixRequest):
    logger.info("Received alert: %s — %s", payload.alert_name, payload.description)

    investigation_id = uuid.uuid4().hex[:12]
    investigation = {
        "id": investigation_id,
        "alert_name": payload.alert_name,
        "description": payload.description,
        "labels": payload.labels,
        "annotations": payload.annotations,
        "related_traces": [t.model_dump() for t in payload.related_traces],
        "status": "pending",
        "analysis": "",
        "pr_url": "",
        "error": "",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "completedAt": "",
    }

    with investigations_lock:
        investigations.append(investigation)
        if len(investigations) > MAX_INVESTIGATIONS:
            del investigations[: len(investigations) - MAX_INVESTIGATIONS]

    thread = Thread(target=run_investigation, args=(investigation_id, payload), daemon=True)
    thread.start()

    return {"status": "accepted", "investigation_id": investigation_id}


@app.get("/api/investigations")
async def get_investigations():
    with investigations_lock:
        return list(investigations)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve the React frontend
static_dir = Path(__file__).parent / "static"
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
