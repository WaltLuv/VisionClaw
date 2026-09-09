"""Durable task HTTP client shared by the LiveKit voice tools.

Polling survives conversation turns. Cancelling this local waiter does not cancel
the server assignment; cancellation is an explicit, separately authorized action.
"""
import asyncio
import time
import uuid
import aiohttp


async def await_run(base_url, headers, run_id, *, interval=1.5, deadline_seconds=1800):
    deadline = time.monotonic() + deadline_seconds
    async with aiohttp.ClientSession() as http:
        while time.monotonic() < deadline:
            try:
                async with http.get(f"{base_url}/api/runs/{run_id}", headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=20)) as response:
                    if response.status in (401, 403, 404):
                        return "I can't access that assignment. Please sign in and check Tasks."
                    response.raise_for_status()
                    run = await response.json()
                if run["status"] == "completed":
                    return run.get("result") or "The task ended without a verified result."
                if run["status"] in ("failed", "cancelled"):
                    return run.get("error") or f"The assignment was {run['status']}."
                if run.get("recovered"):
                    return "The server restarted. Please review this assignment in Tasks before resuming it."
            except (aiohttp.ClientError, asyncio.TimeoutError):
                # Reads may be retried. Never repeat the original action submission here.
                pass
            await asyncio.sleep(interval)
    return "This assignment is still saved in Tasks. Check its status there; it has not been resubmitted."


async def execute_task(base_url, headers, task, image=None, source="phone"):
    payload = {"messages": [{"role": "user", "content": task}], "source": source}
    if image:
        payload["image"] = image
    request_headers = {**headers, "Idempotency-Key": str(uuid.uuid4())}
    async with aiohttp.ClientSession() as http:
        async with http.post(f"{base_url}/v1/chat/completions", headers=request_headers,
                             json=payload, timeout=aiohttp.ClientTimeout(total=30)) as response:
            response.raise_for_status()
            result = await response.json()
    if result.get("runId"):
        return await await_run(base_url, headers, result["runId"])
    # Compatibility with an older gateway while worker/gateway upgrades roll out.
    return result["choices"][0]["message"]["content"]
