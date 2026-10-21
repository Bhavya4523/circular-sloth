"""Exercise a live API using fresh, unpredictable facts and a real model."""
from __future__ import annotations

import argparse
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.tls import create_verified_ssl_context

load_dotenv()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    amount = random.randint(137, 987)
    event_date = today + timedelta(days=random.randint(35, 210))
    circular = f"School event and fee due date: {event_date.strftime('%d %B %Y')}. School event fee: Rs {amount}/-, payable on the event date above."
    deadline = time.monotonic() + 180
    with httpx.Client(timeout=130, verify=create_verified_ssl_context()) as client:
        while True:
            try:
                health = client.get(f"{base_url}/api/health")
                if health.status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if time.monotonic() >= deadline:
                print("FAIL: API health did not become available within 180 seconds")
                return 1
            time.sleep(2)
        health_data = health.json()
        print(f"Health: status={health_data.get('status')} provider={health_data.get('provider')} model_reachable={health_data.get('model_reachable')}")
        if not health_data.get("model_reachable"):
            print(f"FAIL: configured model is unreachable ({health_data.get('model_status', 'unknown reason')})")
            return 1
        request = {
            "today": today.isoformat(),
            "language_hint": "English",
            "chunks": [{"id": "smoke-live", "text": circular}],
        }
        response = None
        for attempt in range(5):
            try:
                response = client.post(f"{base_url}/api/read", json=request)
            except httpx.HTTPError as exc:
                print(f"FAIL: /api/read network error ({type(exc).__name__}): {exc}")
                return 1
            if response.status_code != 503 or "busy" not in response.text.lower():
                break
            if attempt < 4:
                time.sleep((2, 5, 10, 10)[attempt])
        assert response is not None
        if response.status_code != 200:
            print(f"FAIL: /api/read returned HTTP {response.status_code}: {response.text[:500]}")
            return 1
        result = response.json()
        print("Read response:")
        print(response.text)
        matching = [
            item for item in result.get("items", [])
            if item.get("amount") == amount and item.get("date") == event_date.isoformat()
        ]
        if len(matching) != 1:
            print(f"FAIL: expected exactly one item with amount={amount} and date={event_date.isoformat()}; found {len(matching)}")
            return 1
        print(f"PASS: real model returned the injected amount {amount} and date {event_date.isoformat()} exactly once")
        return 0


if __name__ == "__main__":
    sys.exit(main())
