import os
import json
import uuid
import logging
import asyncio
from datetime import datetime, timezone
from threading import Thread, Lock

import requests
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool
from langchain_core.messages import AIMessage, ToolMessage
from playwright.sync_api import sync_playwright

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("business-agent")

app = FastAPI(title="Business Agent")

REPO_URL = os.getenv("REPO_URL", "https://github.com/salaboy/reacting-to-ai.git")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")

SYSTEM_PROMPT = (
    "You are a business validation agent. You interact with web applications "
    "to verify that user-facing features work correctly, as a real user would.\n\n"
    "Your goal is to navigate a website, perform actions, and ensure everything "
    "works without errors. You act like an end user testing the application.\n\n"
    "Follow these steps:\n"
    "1. Navigate to the provided URL\n"
    "2. Read the page content and identify interactive elements (links, buttons, forms, inputs)\n"
    "3. If a description of actions to check was provided, focus on those specific actions\n"
    "4. If no description was provided, explore the page and try every interactive element you find\n"
    "5. For each action, check that:\n"
    "   - The page responds without HTTP errors\n"
    "   - No JavaScript errors appear in the console\n"
    "   - No error messages are displayed on the page\n"
    "   - The expected behavior occurs (navigation, form submission, content update, etc.)\n"
    "6. After completing all checks, produce a summary of findings\n\n"
    "Be thorough and systematic. Try clicking every button, following every link, "
    "and submitting every form you find. Report any errors, broken elements, or "
    "unexpected behaviors you encounter.\n\n"
    "IMPORTANT: You expect ZERO errors. Any error is a finding that must be reported."
)


class ValidateRequest(BaseModel):
    url: str
    description: str = ""


validations_lock = Lock()
validations: list[dict] = []
MAX_VALIDATIONS = 50


def create_tools(base_url: str):
    browser_state = {"browser": None, "page": None, "console_errors": []}

    def _ensure_browser():
        if browser_state["browser"] is None:
            pw = sync_playwright().start()
            browser_state["browser"] = pw.chromium.launch(headless=True)
            page = browser_state["browser"].new_page()
            page.on("console", lambda msg: (
                browser_state["console_errors"].append(
                    f"[{msg.type}] {msg.text}"
                ) if msg.type == "error" else None
            ))
            page.on("pageerror", lambda err: (
                browser_state["console_errors"].append(f"[page-error] {err}")
            ))
            browser_state["page"] = page
        return browser_state["page"]

    @tool
    def navigate(url: str) -> str:
        """Navigate the browser to a URL. Returns the page title and status."""
        page = _ensure_browser()
        browser_state["console_errors"].clear()
        try:
            response = page.goto(url, wait_until="networkidle", timeout=30000)
            status = response.status if response else "unknown"
            title = page.title()
            return (
                f"Navigated to: {url}\n"
                f"Status: {status}\n"
                f"Title: {title}\n"
                f"Console errors so far: {len(browser_state['console_errors'])}"
            )
        except Exception as e:
            return f"Error navigating to {url}: {e}"

    @tool
    def get_page_content() -> str:
        """Get the text content of the current page."""
        page = _ensure_browser()
        try:
            content = page.inner_text("body")
            if len(content) > 10000:
                content = content[:10000] + "\n... (truncated)"
            url = page.url
            title = page.title()
            return (
                f"URL: {url}\nTitle: {title}\n\n"
                f"Page content:\n{content}"
            )
        except Exception as e:
            return f"Error reading page content: {e}"

    @tool
    def list_interactive_elements() -> str:
        """List all interactive elements on the current page (links, buttons, inputs, forms)."""
        page = _ensure_browser()
        try:
            elements = page.evaluate("""() => {
                const results = [];

                document.querySelectorAll('a[href]').forEach((el, i) => {
                    results.push({
                        type: 'link',
                        index: i,
                        text: el.innerText.trim().substring(0, 100),
                        href: el.href,
                        selector: `a[href="${el.getAttribute('href')}"]`
                    });
                });

                document.querySelectorAll('button').forEach((el, i) => {
                    results.push({
                        type: 'button',
                        index: i,
                        text: el.innerText.trim().substring(0, 100),
                        disabled: el.disabled,
                        selector: el.id ? `#${el.id}` : `button >> text="${el.innerText.trim().substring(0, 50)}"`
                    });
                });

                document.querySelectorAll('input, textarea, select').forEach((el, i) => {
                    results.push({
                        type: el.tagName.toLowerCase(),
                        inputType: el.type || '',
                        index: i,
                        name: el.name || '',
                        placeholder: el.placeholder || '',
                        selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : `${el.tagName.toLowerCase()}:nth-of-type(${i + 1})`
                    });
                });

                document.querySelectorAll('form').forEach((el, i) => {
                    results.push({
                        type: 'form',
                        index: i,
                        action: el.action || '',
                        method: el.method || 'get',
                        selector: el.id ? `#${el.id}` : `form:nth-of-type(${i + 1})`
                    });
                });

                return results;
            }""")
            if not elements:
                return "No interactive elements found on the page."
            return json.dumps(elements, indent=2)
        except Exception as e:
            return f"Error listing elements: {e}"

    @tool
    def click_element(selector: str) -> str:
        """Click an element on the page using a CSS selector or text selector."""
        page = _ensure_browser()
        errors_before = len(browser_state["console_errors"])
        try:
            page.click(selector, timeout=10000)
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception as e:
            return f"Error clicking '{selector}': {e}"

        new_errors = browser_state["console_errors"][errors_before:]
        result = (
            f"Clicked: {selector}\n"
            f"Current URL: {page.url}\n"
            f"Page title: {page.title()}"
        )
        if new_errors:
            result += f"\nConsole errors after click:\n" + "\n".join(new_errors)
        return result

    @tool
    def fill_input(selector: str, value: str) -> str:
        """Fill an input field with a value using a CSS selector."""
        page = _ensure_browser()
        try:
            page.fill(selector, value, timeout=10000)
            return f"Filled '{selector}' with: {value}"
        except Exception as e:
            return f"Error filling '{selector}': {e}"

    @tool
    def submit_form(selector: str = "form") -> str:
        """Submit a form. Provide the form selector or defaults to the first form."""
        page = _ensure_browser()
        errors_before = len(browser_state["console_errors"])
        try:
            page.evaluate(f'document.querySelector("{selector}").submit()')
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception as e:
            return f"Error submitting form '{selector}': {e}"

        new_errors = browser_state["console_errors"][errors_before:]
        result = (
            f"Submitted form: {selector}\n"
            f"Current URL: {page.url}\n"
            f"Page title: {page.title()}"
        )
        if new_errors:
            result += f"\nConsole errors after submit:\n" + "\n".join(new_errors)
        return result

    @tool
    def check_for_errors() -> str:
        """Check the current page for visible error messages and console errors."""
        page = _ensure_browser()
        try:
            visible_errors = page.evaluate("""() => {
                const errorPatterns = [
                    '[class*="error"]', '[class*="Error"]',
                    '[class*="alert-danger"]', '[class*="alert-error"]',
                    '[role="alert"]',
                    '.toast-error', '.notification-error'
                ];
                const errors = [];
                errorPatterns.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => {
                        const text = el.innerText.trim();
                        if (text && text.length > 0 && text.length < 500) {
                            errors.push({selector, text});
                        }
                    });
                });
                return errors;
            }""")
        except Exception:
            visible_errors = []

        console_errors = browser_state["console_errors"]

        parts = []
        if visible_errors:
            parts.append("Visible error elements found:")
            for err in visible_errors:
                parts.append(f"  - [{err['selector']}]: {err['text']}")
        else:
            parts.append("No visible error elements found on the page.")

        if console_errors:
            parts.append(f"\nConsole errors ({len(console_errors)}):")
            for err in console_errors:
                parts.append(f"  - {err}")
        else:
            parts.append("No console errors.")

        return "\n".join(parts)

    @tool
    def get_current_url() -> str:
        """Get the current URL of the browser."""
        page = _ensure_browser()
        return f"Current URL: {page.url}"

    def cleanup():
        if browser_state["browser"]:
            try:
                browser_state["browser"].close()
            except Exception:
                pass

    tools = [
        navigate, get_page_content, list_interactive_elements,
        click_element, fill_input, submit_form, check_for_errors,
        get_current_url,
    ]
    return tools, cleanup


def create_agent(tools):
    llm = ChatAnthropic(model=ANTHROPIC_MODEL)
    logger.info("Using model: %s", llm.model)
    return create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)


def create_github_issue(title: str, body: str) -> str:
    parts = REPO_URL.rstrip("/").removesuffix(".git").split("/")
    owner, repo = parts[-2], parts[-1]

    resp = requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/issues",
        headers={
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
        },
        json={
            "title": title,
            "body": body,
            "labels": ["business-agent"],
        },
    )
    resp.raise_for_status()
    return resp.json().get("html_url", "")


def add_step(validation_id: str, step_type: str, data: dict):
    with validations_lock:
        for v in validations:
            if v["id"] == validation_id:
                v["steps"].append({
                    "type": step_type,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": data,
                })
                break


def update_validation(validation_id: str, updates: dict):
    with validations_lock:
        for v in validations:
            if v["id"] == validation_id:
                if "status" in updates and updates["status"] != v.get("status"):
                    v["steps"].append({
                        "type": "status_change",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "data": {"status": updates["status"]},
                    })
                v.update(updates)
                break


def run_validation(validation_id: str, payload: ValidateRequest):
    update_validation(validation_id, {"status": "browsing"})

    tools, cleanup = create_tools(payload.url)
    try:
        agent = create_agent(tools)

        description_context = ""
        if payload.description:
            description_context = (
                f"\n\nThe user wants you to specifically check: {payload.description}"
            )
        else:
            description_context = (
                "\n\nNo specific actions were requested. Explore the page thoroughly "
                "and test every interactive element you can find."
            )

        user_prompt = (
            f"Validate the website at: {payload.url}"
            f"{description_context}\n\n"
            f"Navigate to the URL, interact with the page, and report any issues found. "
            f"Remember: you expect ZERO errors from any interaction."
        )

        all_messages = []
        for chunk in agent.stream(
            {"messages": [{"role": "user", "content": user_prompt}]},
        ):
            for node_output in chunk.values():
                for msg in node_output.get("messages", []):
                    all_messages.append(msg)
                    if isinstance(msg, AIMessage):
                        if msg.tool_calls:
                            for tc in msg.tool_calls:
                                add_step(validation_id, "tool_call", {
                                    "tool": tc["name"],
                                    "input": tc["args"],
                                })
                        elif msg.content:
                            content = msg.content if isinstance(msg.content, str) else str(msg.content)
                            add_step(validation_id, "agent_response", {
                                "content": content,
                            })
                    elif isinstance(msg, ToolMessage):
                        content = msg.content if isinstance(msg.content, str) else str(msg.content)
                        if len(content) > 5000:
                            content = content[:5000] + "\n... (truncated)"
                        add_step(validation_id, "tool_result", {
                            "tool": msg.name,
                            "output": content,
                        })

        analysis = all_messages[-1].content if all_messages else ""
        if isinstance(analysis, list):
            analysis = "\n".join(
                block.get("text", str(block)) if isinstance(block, dict) else str(block)
                for block in analysis
            )

        has_issues = any(
            keyword in analysis.lower()
            for keyword in ["error", "fail", "broken", "issue", "bug", "not working", "unexpected"]
        )

        if has_issues and GITHUB_TOKEN:
            update_validation(validation_id, {"status": "creating_issue"})
            issue_title = f"Business validation issue on {payload.url}"
            issue_body = (
                f"## Validation Report\n\n"
                f"**URL:** {payload.url}\n"
                f"**Description:** {payload.description or 'Full site exploration'}\n\n"
                f"## Findings\n\n{analysis}\n\n"
                f"---\nGenerated by business-agent"
            )
            try:
                issue_url = create_github_issue(issue_title, issue_body)
                logger.info("GitHub issue created: %s", issue_url)
                update_validation(validation_id, {
                    "status": "issue_created",
                    "analysis": analysis,
                    "issue_url": issue_url,
                    "completedAt": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                logger.exception("Failed to create GitHub issue")
                update_validation(validation_id, {
                    "status": "completed",
                    "analysis": analysis,
                    "error": f"Validation found issues but failed to create GitHub issue: {e}",
                    "completedAt": datetime.now(timezone.utc).isoformat(),
                })
        else:
            update_validation(validation_id, {
                "status": "no_issues",
                "analysis": analysis,
                "completedAt": datetime.now(timezone.utc).isoformat(),
            })

    except Exception as e:
        logger.exception("Error during validation")
        update_validation(validation_id, {
            "status": "error",
            "error": str(e),
            "completedAt": datetime.now(timezone.utc).isoformat(),
        })
    finally:
        cleanup()


@app.post("/validate")
async def validate_url(payload: ValidateRequest):
    logger.info("Received validation request: %s — %s", payload.url, payload.description)

    validation_id = uuid.uuid4().hex[:12]
    validation = {
        "id": validation_id,
        "url": payload.url,
        "description": payload.description,
        "status": "pending",
        "steps": [],
        "analysis": "",
        "issue_url": "",
        "error": "",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "completedAt": "",
    }

    with validations_lock:
        validations.append(validation)
        if len(validations) > MAX_VALIDATIONS:
            del validations[: len(validations) - MAX_VALIDATIONS]

    thread = Thread(target=run_validation, args=(validation_id, payload), daemon=True)
    thread.start()

    return {"status": "accepted", "validation_id": validation_id}


@app.get("/api/validations")
async def get_validations():
    with validations_lock:
        return list(validations)


@app.get("/api/validations/{validation_id}")
async def get_validation(validation_id: str):
    with validations_lock:
        for v in validations:
            if v["id"] == validation_id:
                return v
    raise HTTPException(status_code=404, detail="Validation not found")


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve the React frontend
from pathlib import Path

static_dir = Path(__file__).parent / "static"
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
