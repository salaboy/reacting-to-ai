"""
PR Reviewer Agent — reviews pull request code using Claude and posts
review comments via the GitHub API.

Runs as a GitHub Action on every pull_request (opened / synchronize).
"""

import json
import logging
import os
import re
import sys

import requests
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("reviewer-agent")

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
MAX_INLINE_COMMENTS = 25
MAX_FILE_CHARS = 50_000

SKIP_PATTERNS = [
    "package-lock.json",
    "go.sum",
    "yarn.lock",
    "pnpm-lock.yaml",
    "node_modules/",
    "dist/",
    "__pycache__/",
    ".min.js",
    ".min.css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
]

FILE_REVIEW_SYSTEM_PROMPT = (
    "You are a code reviewer. You will be given a file's diff (patch) from a pull request "
    "and the full file content for context.\n\n"
    "Review the CHANGED lines (the diff) for:\n"
    "- Bugs and logical errors\n"
    "- Security vulnerabilities\n"
    "- Error handling issues\n"
    "- Performance problems\n"
    "- Clear style or readability issues\n\n"
    "Only comment on meaningful issues. Do NOT nitpick formatting, naming conventions, "
    "or add suggestions for comments/docstrings. Focus on things that could cause problems.\n\n"
    "Respond with a JSON object (no markdown fences) in this exact format:\n"
    '{"comments": [{"line": <line_number_in_new_file>, "body": "<comment>", "severity": "<info|warning|error>"}]}\n\n'
    "If there are no issues, respond with: {\"comments\": []}\n\n"
    "IMPORTANT: The 'line' field must be a line number that appears in the NEW version "
    "of the file (right side of the diff — lines starting with '+' or unchanged context lines). "
    "Do not reference removed lines."
)

SUMMARY_SYSTEM_PROMPT = (
    "You are a code reviewer summarizing your review of a pull request.\n\n"
    "You will be given the full PR diff and a list of issues found during file-by-file review.\n\n"
    "Provide a concise overall assessment. Respond with a JSON object (no markdown fences):\n"
    '{"summary": "<overall assessment in markdown>", "action": "<APPROVE|REQUEST_CHANGES|COMMENT>", '
    '"key_concerns": ["<concern1>", "<concern2>"]}\n\n'
    "Guidelines for the action field:\n"
    "- APPROVE: No issues or only minor informational comments\n"
    "- COMMENT: Some warnings or suggestions but nothing blocking\n"
    "- REQUEST_CHANGES: Bugs, security issues, or errors that should be fixed before merging\n\n"
    "Keep the summary concise — 3-5 sentences max. Use markdown formatting."
)


# ---------------------------------------------------------------------------
# GitHub API helpers
# ---------------------------------------------------------------------------

def github_headers(token: str, accept: str = "application/vnd.github+json") -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": accept}


def fetch_pr_metadata(repo: str, pr_number: int, token: str) -> dict:
    resp = requests.get(
        f"https://api.github.com/repos/{repo}/pulls/{pr_number}",
        headers=github_headers(token),
    )
    resp.raise_for_status()
    return resp.json()


def fetch_changed_files(repo: str, pr_number: int, token: str) -> list[dict]:
    files = []
    page = 1
    while True:
        resp = requests.get(
            f"https://api.github.com/repos/{repo}/pulls/{pr_number}/files",
            headers=github_headers(token),
            params={"per_page": 100, "page": page},
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        files.extend(batch)
        page += 1
    return files


def fetch_pr_diff(repo: str, pr_number: int, token: str) -> str:
    resp = requests.get(
        f"https://api.github.com/repos/{repo}/pulls/{pr_number}",
        headers=github_headers(token, accept="application/vnd.github.v3.diff"),
    )
    resp.raise_for_status()
    return resp.text


def submit_review(
    repo: str,
    pr_number: int,
    head_sha: str,
    body: str,
    event: str,
    comments: list[dict],
    token: str,
):
    payload = {
        "commit_id": head_sha,
        "body": body,
        "event": event,
        "comments": comments,
    }
    resp = requests.post(
        f"https://api.github.com/repos/{repo}/pulls/{pr_number}/reviews",
        headers=github_headers(token),
        json=payload,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Diff parsing
# ---------------------------------------------------------------------------

def parse_valid_diff_lines(patch: str) -> set[int]:
    """Extract line numbers on the RIGHT side of a unified diff that can receive comments."""
    valid = set()
    if not patch:
        return valid

    current_line = 0
    for raw_line in patch.split("\n"):
        hunk_match = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", raw_line)
        if hunk_match:
            current_line = int(hunk_match.group(1))
            continue

        if current_line == 0:
            continue

        if raw_line.startswith("+"):
            valid.add(current_line)
            current_line += 1
        elif raw_line.startswith("-"):
            # Removed line — no increment on new-file side
            pass
        else:
            # Context line
            valid.add(current_line)
            current_line += 1

    return valid


def should_skip(filename: str) -> bool:
    for pattern in SKIP_PATTERNS:
        if pattern.endswith("/"):
            if f"/{pattern}" in f"/{filename}" or filename.startswith(pattern):
                return True
        elif filename.endswith(pattern) or filename == pattern:
            return True
    return False


# ---------------------------------------------------------------------------
# Claude helpers
# ---------------------------------------------------------------------------

def extract_json(text: str) -> dict | None:
    """Try to extract a JSON object from Claude's response, handling markdown fences."""
    # Try the raw text first
    text = text.strip()
    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

    # Try to find JSON in markdown code fences
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try to find any JSON object in the text
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return None


def review_file(llm: ChatAnthropic, filename: str, patch: str, content: str | None) -> list[dict]:
    """Ask Claude to review a single file's changes. Returns list of comment dicts."""
    user_text = f"## File: {filename}\n\n### Diff (patch)\n```\n{patch}\n```"
    if content:
        truncated = content[:MAX_FILE_CHARS]
        if len(content) > MAX_FILE_CHARS:
            truncated += "\n... (file truncated)"
        user_text += f"\n\n### Full file content\n```\n{truncated}\n```"

    messages = [
        SystemMessage(content=FILE_REVIEW_SYSTEM_PROMPT),
        HumanMessage(content=user_text),
    ]

    try:
        response = llm.invoke(messages)
    except Exception as e:
        logger.warning("Claude API error reviewing %s: %s", filename, e)
        return []

    result = extract_json(response.content)
    if result is None:
        logger.warning("Could not parse JSON from Claude response for %s", filename)
        return []

    comments = []
    for c in result.get("comments", []):
        if "line" in c and "body" in c:
            comments.append({
                "path": filename,
                "line": c["line"],
                "side": "RIGHT",
                "body": f"**{c.get('severity', 'info').upper()}**: {c['body']}",
            })
    return comments


def generate_summary(llm: ChatAnthropic, diff: str, all_comments: list[dict], pr_meta: dict) -> dict:
    """Ask Claude for an overall PR summary and recommended action."""
    findings = "No issues found." if not all_comments else ""
    if all_comments:
        lines = []
        for c in all_comments:
            lines.append(f"- **{c['path']}** line {c['line']}: {c['body']}")
        findings = "\n".join(lines)

    # Truncate diff if very large
    max_diff = 80_000
    if len(diff) > max_diff:
        diff = diff[:max_diff] + "\n... (diff truncated)"

    user_text = (
        f"## Pull Request\n\n"
        f"**Title:** {pr_meta.get('title', '')}\n"
        f"**Author:** {pr_meta.get('user', {}).get('login', '')}\n"
        f"**Description:** {pr_meta.get('body', '') or 'No description provided.'}\n\n"
        f"## Diff\n```\n{diff}\n```\n\n"
        f"## Issues Found\n{findings}"
    )

    messages = [
        SystemMessage(content=SUMMARY_SYSTEM_PROMPT),
        HumanMessage(content=user_text),
    ]

    try:
        response = llm.invoke(messages)
    except Exception as e:
        logger.warning("Claude API error generating summary: %s", e)
        return {"summary": "Review could not be completed due to an API error.", "action": "COMMENT", "key_concerns": []}

    result = extract_json(response.content)
    if result is None:
        return {"summary": response.content, "action": "COMMENT", "key_concerns": []}

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    token = os.environ.get("GITHUB_TOKEN", "")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    pr_number_str = os.environ.get("PR_NUMBER", "")

    if not all([token, anthropic_key, repo, pr_number_str]):
        logger.error("Missing required environment variables: GITHUB_TOKEN, ANTHROPIC_API_KEY, GITHUB_REPOSITORY, PR_NUMBER")
        sys.exit(1)

    pr_number = int(pr_number_str)
    logger.info("Reviewing PR #%d in %s", pr_number, repo)

    # Fetch PR data
    pr_meta = fetch_pr_metadata(repo, pr_number, token)
    head_sha = pr_meta["head"]["sha"]
    changed_files = fetch_changed_files(repo, pr_number, token)

    reviewable_files = [
        f for f in changed_files
        if f.get("status") != "removed" and not should_skip(f["filename"]) and f.get("patch")
    ]

    if not reviewable_files:
        logger.info("No reviewable files changed — skipping review.")
        return

    logger.info("Reviewing %d file(s) out of %d changed", len(reviewable_files), len(changed_files))

    # Initialize Claude
    llm = ChatAnthropic(model=ANTHROPIC_MODEL, api_key=anthropic_key)

    # Phase 1: Review each file
    all_comments = []
    for file_info in reviewable_files:
        filename = file_info["filename"]
        patch = file_info.get("patch", "")
        logger.info("Reviewing: %s", filename)

        # Fetch full file content for context
        content = None
        try:
            resp = requests.get(
                f"https://api.github.com/repos/{repo}/contents/{filename}",
                headers=github_headers(token),
                params={"ref": head_sha},
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("encoding") == "base64":
                    import base64
                    content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception as e:
            logger.warning("Could not fetch content for %s: %s", filename, e)

        file_comments = review_file(llm, filename, patch, content)
        all_comments.extend(file_comments)

    # Phase 2: Validate comments against diff
    validated_comments = []
    for comment in all_comments:
        file_info = next((f for f in reviewable_files if f["filename"] == comment["path"]), None)
        if not file_info:
            continue
        valid_lines = parse_valid_diff_lines(file_info.get("patch", ""))
        if comment["line"] in valid_lines:
            validated_comments.append(comment)
        else:
            logger.warning("Dropping comment on %s:%d — not in diff", comment["path"], comment["line"])

    # Cap the number of inline comments
    if len(validated_comments) > MAX_INLINE_COMMENTS:
        logger.info("Capping inline comments from %d to %d", len(validated_comments), MAX_INLINE_COMMENTS)
        validated_comments = validated_comments[:MAX_INLINE_COMMENTS]

    # Phase 3: Generate overall summary
    diff = fetch_pr_diff(repo, pr_number, token)
    summary_result = generate_summary(llm, diff, all_comments, pr_meta)

    summary_body = summary_result.get("summary", "Review complete.")
    action = summary_result.get("action", "COMMENT")
    key_concerns = summary_result.get("key_concerns", [])

    # Build the review body
    review_body = f"## AI Code Review\n\n{summary_body}"
    if key_concerns:
        review_body += "\n\n### Key Concerns\n"
        for concern in key_concerns:
            review_body += f"- {concern}\n"
    review_body += "\n\n---\n*Generated by reviewer-agent using Claude*"

    # Only use APPROVE/REQUEST_CHANGES if Claude is confident; default to COMMENT
    if action not in ("APPROVE", "REQUEST_CHANGES", "COMMENT"):
        action = "COMMENT"

    logger.info("Submitting review with action=%s, %d inline comment(s)", action, len(validated_comments))

    submit_review(
        repo=repo,
        pr_number=pr_number,
        head_sha=head_sha,
        body=review_body,
        event=action,
        comments=validated_comments,
        token=token,
    )

    logger.info("Review submitted successfully.")


if __name__ == "__main__":
    main()
