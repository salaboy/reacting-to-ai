import os
import json
import uuid
import logging
import asyncio
from datetime import datetime, timezone
from threading import Thread, Lock
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool
from langchain_core.messages import AIMessage, ToolMessage
from playwright.async_api import async_playwright

from telemetry import init_telemetry, instrument_fastapi

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("business-agent")

init_telemetry("business-agent")

app = FastAPI(title="Business Agent")
instrument_fastapi(app)

REPO_URL = os.getenv("REPO_URL", "https://github.com/salaboy/reacting-to-ai.git")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
DEFAULT_TARGET_URL = os.getenv(
    "DEFAULT_TARGET_URL", "http://homebanking-app.default.svc.cluster.local"
)
PR_TARGET_URL_TEMPLATE = os.getenv(
    "PR_TARGET_URL_TEMPLATE", "http://homebanking-app.pr-{number}.svc.cluster.local"
)


VALIDATION_CATALOG: list[dict] = [
    {
        "id": "support-tab",
        "name": "Support tab",
        "description": (
            "Open the Support tab and verify the page loads with no errors. "
            "Check that the help articles, FAQs, and contact options are visible."
        ),
    },
    {
        "id": "contact-representative",
        "name": "Contact a representative",
        "description": (
            "From the Support area, use the 'Contact a representative' functionality. "
            "Fill in the contact form with a sample name, email and message, submit it, "
            "and confirm the confirmation/acknowledgement is shown without errors."
        ),
    },
    {
        "id": "login-flow",
        "name": "Login flow",
        "description": (
            "Locate the login form, sign in with the demo user, and verify the "
            "authenticated dashboard loads without errors."
        ),
    },
    {
        "id": "account-overview",
        "name": "Account overview",
        "description": (
            "Open the main account / dashboard view and check balances, account list "
            "and recent transactions render correctly."
        ),
    },
    {
        "id": "transfer-funds",
        "name": "Transfer funds between accounts",
        "description": (
            "Use the 'Transfer' feature to move a small amount between two accounts. "
            "Confirm the transfer is accepted and the confirmation screen is shown."
        ),
    },
    {
        "id": "pay-bill",
        "name": "Pay a bill",
        "description": (
            "Use the 'Pay a bill' / 'Bill pay' feature, fill in payee details and "
            "an amount, submit and verify the confirmation."
        ),
    },
    {
        "id": "transactions-history",
        "name": "Transactions history",
        "description": (
            "Open the transactions / activity page and verify the list renders, "
            "filters/search work, and pagination (if any) does not produce errors."
        ),
    },
    {
        "id": "profile-settings",
        "name": "Profile settings update",
        "description": (
            "Open profile / account settings, update a field (e.g. phone number "
            "or address), save it and confirm the update succeeds."
        ),
    },
    {
        "id": "logout",
        "name": "Logout flow",
        "description": (
            "Use the logout action and verify the user is returned to the public "
            "landing/login page with no errors."
        ),
    },
]

SYSTEM_PROMPT = (
    "You are a business evaluation agent. You interact with web applications "
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
    "IMPORTANT TIPS:\n"
    "- For <select> dropdowns, use the select_option tool (not fill_input)\n"
    "- To submit forms in modern web apps (React, Vue, etc.), click the submit button "
    "using click_element instead of using submit_form, so that the app's event handlers fire correctly\n"
    "- After submitting a form, always check the page content and check_for_errors to see the result\n"
    "- You expect ZERO errors. Any error is a finding that must be reported."
)


class EvaluateRequest(BaseModel):
    url: str
    description: str = ""


class EvaluationVerdict(BaseModel):
    """Structured verdict produced by the classifier LLM after a evaluation run."""
    passed: bool
    summary: str


evaluations_lock = Lock()
evaluations: list[dict] = []
MAX_EVALUATIONS = 50


def create_tools(browser_state: dict):
    @tool
    async def navigate(url: str) -> str:
        """Navigate the browser to a URL. Returns the page title and status."""
        page = browser_state["page"]
        browser_state["console_errors"].clear()
        try:
            response = await page.goto(url, wait_until="networkidle", timeout=30000)
            status = response.status if response else "unknown"
            title = await page.title()
            return (
                f"Navigated to: {url}\n"
                f"Status: {status}\n"
                f"Title: {title}\n"
                f"Console errors so far: {len(browser_state['console_errors'])}"
            )
        except Exception as e:
            return f"Error navigating to {url}: {e}"

    @tool
    async def get_page_content() -> str:
        """Get the text content of the current page."""
        page = browser_state["page"]
        try:
            content = await page.inner_text("body")
            if len(content) > 10000:
                content = content[:10000] + "\n... (truncated)"
            url = page.url
            title = await page.title()
            return (
                f"URL: {url}\nTitle: {title}\n\n"
                f"Page content:\n{content}"
            )
        except Exception as e:
            return f"Error reading page content: {e}"

    @tool
    async def list_interactive_elements() -> str:
        """List all interactive elements on the current page (links, buttons, inputs, forms)."""
        page = browser_state["page"]
        try:
            elements = await page.evaluate("""() => {
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
    async def click_element(selector: str) -> str:
        """Click an element on the page using a CSS selector or text selector."""
        page = browser_state["page"]
        errors_before = len(browser_state["console_errors"])
        try:
            await page.click(selector, timeout=10000)
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception as e:
            return f"Error clicking '{selector}': {e}"

        new_errors = browser_state["console_errors"][errors_before:]
        title = await page.title()
        result = (
            f"Clicked: {selector}\n"
            f"Current URL: {page.url}\n"
            f"Page title: {title}"
        )
        if new_errors:
            result += f"\nConsole errors after click:\n" + "\n".join(new_errors)
        return result

    @tool
    async def fill_input(selector: str, value: str) -> str:
        """Fill an input field with a value using a CSS selector."""
        page = browser_state["page"]
        try:
            await page.fill(selector, value, timeout=10000)
            return f"Filled '{selector}' with: {value}"
        except Exception as e:
            return f"Error filling '{selector}': {e}"

    @tool
    async def submit_form(selector: str = "form") -> str:
        """Submit a form. Provide the form selector or defaults to the first form."""
        page = browser_state["page"]
        errors_before = len(browser_state["console_errors"])
        try:
            await page.evaluate(f'document.querySelector("{selector}").submit()')
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception as e:
            return f"Error submitting form '{selector}': {e}"

        new_errors = browser_state["console_errors"][errors_before:]
        title = await page.title()
        result = (
            f"Submitted form: {selector}\n"
            f"Current URL: {page.url}\n"
            f"Page title: {title}"
        )
        if new_errors:
            result += f"\nConsole errors after submit:\n" + "\n".join(new_errors)
        return result

    @tool
    async def select_option(selector: str, value: str = "", label: str = "") -> str:
        """Select an option from a <select> dropdown element.
        Use either value (the option's value attribute) or label (the visible text).
        Example: select_option('select[name="account"]', label='Savings')
        """
        page = browser_state["page"]
        try:
            if label:
                await page.select_option(selector, label=label, timeout=10000)
                return f"Selected option with label '{label}' in '{selector}'"
            elif value:
                await page.select_option(selector, value=value, timeout=10000)
                return f"Selected option with value '{value}' in '{selector}'"
            else:
                return "Error: provide either 'value' or 'label' to select an option."
        except Exception as e:
            return f"Error selecting option in '{selector}': {e}"

    @tool
    async def check_for_errors() -> str:
        """Check the current page for visible error messages and console errors."""
        page = browser_state["page"]
        try:
            visible_errors = await page.evaluate("""() => {
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
    async def get_current_url() -> str:
        """Get the current URL of the browser."""
        page = browser_state["page"]
        return f"Current URL: {page.url}"

    return [
        navigate, get_page_content, list_interactive_elements,
        click_element, fill_input, select_option, submit_form,
        check_for_errors, get_current_url,
    ]


def create_agent(tools):
    llm = ChatAnthropic(model=ANTHROPIC_MODEL)
    logger.info("Using model: %s", llm.model)
    return create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)


async def classify_verdict(url: str, description: str, analysis: str) -> EvaluationVerdict:
    """Ask the LLM to classify the evaluation report as passed/failed.

    Why: keyword scans like "error" produce false positives ("no errors found"),
    causing GitHub issues to be opened for clean evaluations.
    """
    llm = ChatAnthropic(model=ANTHROPIC_MODEL).with_structured_output(EvaluationVerdict)
    prompt = (
        "You are reviewing a business evaluation report produced by a browser agent.\n"
        "Decide whether the evaluation PASSED or FAILED.\n\n"
        "PASSED means: no HTTP errors, no JavaScript console errors, no visible error "
        "messages, and the expected behavior occurred. Mentions like 'no errors found' "
        "or 'no issues detected' indicate PASSED.\n"
        "FAILED means: at least one real error, broken element, unexpected behavior, "
        "or missing functionality was actually observed during the run.\n\n"
        f"URL: {url}\n"
        f"Description: {description or '(full exploration)'}\n\n"
        f"Report:\n{analysis}\n\n"
        "Return passed=true if the run was clean, passed=false if real problems were "
        "observed. The summary should be one short sentence."
    )
    return await llm.ainvoke(prompt)


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


def add_step(evaluation_id: str, step_type: str, data: dict):
    with evaluations_lock:
        for v in evaluations:
            if v["id"] == evaluation_id:
                v["steps"].append({
                    "type": step_type,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": data,
                })
                break


def update_evaluation(evaluation_id: str, updates: dict):
    with evaluations_lock:
        for v in evaluations:
            if v["id"] == evaluation_id:
                if "status" in updates and updates["status"] != v.get("status"):
                    v["steps"].append({
                        "type": "status_change",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "data": {"status": updates["status"]},
                    })
                v.update(updates)
                break


async def run_evaluation(evaluation_id: str, payload: EvaluateRequest):
    update_evaluation(evaluation_id, {"status": "browsing"})

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True)
    browser_state = {"page": None, "console_errors": []}

    try:
        page = await browser.new_page()
        page.on("console", lambda msg: (
            browser_state["console_errors"].append(
                f"[{msg.type}] {msg.text}"
            ) if msg.type == "error" else None
        ))
        page.on("pageerror", lambda err: (
            browser_state["console_errors"].append(f"[page-error] {err}")
        ))
        browser_state["page"] = page

        tools = create_tools(browser_state)
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
            f"Evaluate the website at: {payload.url}"
            f"{description_context}\n\n"
            f"Navigate to the URL, interact with the page, and report any issues found. "
            f"Remember: you expect ZERO errors from any interaction."
        )

        all_messages = []
        async for chunk in agent.astream(
            {"messages": [{"role": "user", "content": user_prompt}]},
        ):
            for node_output in chunk.values():
                for msg in node_output.get("messages", []):
                    all_messages.append(msg)
                    if isinstance(msg, AIMessage):
                        if msg.tool_calls:
                            for tc in msg.tool_calls:
                                add_step(evaluation_id, "tool_call", {
                                    "tool": tc["name"],
                                    "input": tc["args"],
                                })
                        elif msg.content:
                            content = msg.content if isinstance(msg.content, str) else str(msg.content)
                            add_step(evaluation_id, "agent_response", {
                                "content": content,
                            })
                    elif isinstance(msg, ToolMessage):
                        content = msg.content if isinstance(msg.content, str) else str(msg.content)
                        if len(content) > 5000:
                            content = content[:5000] + "\n... (truncated)"
                        add_step(evaluation_id, "tool_result", {
                            "tool": msg.name,
                            "output": content,
                        })

        analysis = all_messages[-1].content if all_messages else ""
        if isinstance(analysis, list):
            analysis = "\n".join(
                block.get("text", str(block)) if isinstance(block, dict) else str(block)
                for block in analysis
            )

        try:
            verdict = await classify_verdict(payload.url, payload.description, analysis)
        except Exception as e:
            logger.exception("Failed to classify evaluation verdict")
            update_evaluation(evaluation_id, {
                "status": "error",
                "analysis": analysis,
                "error": f"Failed to classify evaluation result: {e}",
                "completedAt": datetime.now(timezone.utc).isoformat(),
            })
            return

        if verdict.passed:
            update_evaluation(evaluation_id, {
                "status": "evaluated",
                "passed": True,
                "summary": verdict.summary,
                "analysis": analysis,
                "completedAt": datetime.now(timezone.utc).isoformat(),
            })
        elif GITHUB_TOKEN:
            update_evaluation(evaluation_id, {"status": "creating_issue"})
            issue_title = f"Business evaluation issue on {payload.url}"
            issue_body = (
                f"## Evaluation Report\n\n"
                f"**URL:** {payload.url}\n"
                f"**Description:** {payload.description or 'Full site exploration'}\n\n"
                f"**Summary:** {verdict.summary}\n\n"
                f"## Findings\n\n{analysis}\n\n"
                f"---\nGenerated by business-agent"
            )
            try:
                issue_url = create_github_issue(issue_title, issue_body)
                logger.info("GitHub issue created: %s", issue_url)
                update_evaluation(evaluation_id, {
                    "status": "issue_created",
                    "passed": False,
                    "summary": verdict.summary,
                    "analysis": analysis,
                    "issue_url": issue_url,
                    "completedAt": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                logger.exception("Failed to create GitHub issue")
                update_evaluation(evaluation_id, {
                    "status": "completed",
                    "passed": False,
                    "summary": verdict.summary,
                    "analysis": analysis,
                    "error": f"Evaluation found issues but failed to create GitHub issue: {e}",
                    "completedAt": datetime.now(timezone.utc).isoformat(),
                })
        else:
            update_evaluation(evaluation_id, {
                "status": "completed",
                "passed": False,
                "summary": verdict.summary,
                "analysis": analysis,
                "completedAt": datetime.now(timezone.utc).isoformat(),
            })

    except Exception as e:
        logger.exception("Error during evaluation")
        update_evaluation(evaluation_id, {
            "status": "error",
            "error": str(e),
            "completedAt": datetime.now(timezone.utc).isoformat(),
        })
    finally:
        await browser.close()
        await pw.stop()


def _run_evaluation_in_thread(evaluation_id: str, payload: EvaluateRequest):
    asyncio.run(run_evaluation(evaluation_id, payload))


@app.post("/evaluate")
async def evaluate_url(payload: EvaluateRequest):
    logger.info("Received evaluation request: %s — %s", payload.url, payload.description)

    evaluation_id = uuid.uuid4().hex[:12]
    evaluation = {
        "id": evaluation_id,
        "url": payload.url,
        "description": payload.description,
        "status": "pending",
        "passed": None,
        "summary": "",
        "steps": [],
        "analysis": "",
        "issue_url": "",
        "error": "",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "completedAt": "",
    }

    with evaluations_lock:
        evaluations.append(evaluation)
        if len(evaluations) > MAX_EVALUATIONS:
            del evaluations[: len(evaluations) - MAX_EVALUATIONS]

    thread = Thread(target=_run_evaluation_in_thread, args=(evaluation_id, payload), daemon=True)
    thread.start()

    return {"status": "accepted", "evaluation_id": evaluation_id}


@app.get("/api/evaluations")
async def get_evaluations():
    with evaluations_lock:
        return list(evaluations)


def _to_metadata(v: dict) -> dict:
    return {
        "id": v.get("id"),
        "url": v.get("url"),
        "description": v.get("description"),
        "status": v.get("status"),
        "passed": v.get("passed"),
        "summary": v.get("summary", ""),
        "issue_url": v.get("issue_url", ""),
        "error": v.get("error", ""),
        "createdAt": v.get("createdAt"),
        "completedAt": v.get("completedAt", ""),
    }


@app.get("/api/evaluations/metadata")
async def get_evaluations_metadata(
    status: str | None = None,
    passed: bool | None = None,
    url: str | None = None,
):
    """Lightweight metadata feed for other agents.

    Returns evaluations without the full step history. Optional filters:
    - status: filter by status (e.g. evaluated, issue_created, error)
    - passed: filter by pass/fail boolean
    - url: substring match against the evaluated URL
    """
    with evaluations_lock:
        items = [_to_metadata(v) for v in evaluations]
    if status is not None:
        items = [v for v in items if v["status"] == status]
    if passed is not None:
        items = [v for v in items if v["passed"] is passed]
    if url:
        items = [v for v in items if url in (v["url"] or "")]
    return items


@app.get("/api/evaluations/{evaluation_id}")
async def get_evaluation(evaluation_id: str):
    with evaluations_lock:
        for v in evaluations:
            if v["id"] == evaluation_id:
                return v
    raise HTTPException(status_code=404, detail="Evaluation not found")


@app.get("/api/evaluations/{evaluation_id}/metadata")
async def get_evaluation_metadata(evaluation_id: str):
    with evaluations_lock:
        for v in evaluations:
            if v["id"] == evaluation_id:
                return _to_metadata(v)
    raise HTTPException(status_code=404, detail="Evaluation not found")


@app.get("/api/catalog")
async def get_catalog():
    """Predefined validations that can be launched with one click."""
    return VALIDATION_CATALOG


@app.get("/api/targets")
async def get_targets():
    """Available evaluation targets: the default cluster URL plus open PR previews.

    PR previews are derived from open pull requests on the configured repo. The
    UI shows them disabled when GITHUB_TOKEN is missing or the API call fails,
    but the default target is always returned so the page works offline.
    """
    targets: list[dict] = [
        {
            "id": "default",
            "label": "Default (default namespace)",
            "url": DEFAULT_TARGET_URL,
            "kind": "default",
        }
    ]

    parts = REPO_URL.rstrip("/").removesuffix(".git").split("/")
    if len(parts) < 2:
        return {"targets": targets, "error": "REPO_URL is malformed"}
    owner, repo = parts[-2], parts[-1]

    headers = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

    try:
        resp = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls",
            headers=headers,
            params={"state": "open", "per_page": 50},
            timeout=10,
        )
        resp.raise_for_status()
        prs = resp.json()
    except Exception as e:
        logger.warning("Failed to fetch pull requests: %s", e)
        return {"targets": targets, "error": str(e)}

    for pr in prs:
        number = pr.get("number")
        if number is None:
            continue
        targets.append({
            "id": f"pr-{number}",
            "label": f"PR #{number} — {pr.get('title', '')}",
            "url": PR_TARGET_URL_TEMPLATE.format(number=number),
            "kind": "pr",
            "pr_number": number,
            "pr_url": pr.get("html_url", ""),
            "pr_title": pr.get("title", ""),
            "pr_author": (pr.get("user") or {}).get("login", ""),
            "pr_head_sha": (pr.get("head") or {}).get("sha", ""),
        })

    return {"targets": targets}


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve the React frontend
static_dir = Path(__file__).parent / "static"
if static_dir.is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
