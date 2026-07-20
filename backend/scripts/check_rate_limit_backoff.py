"""Self-check for per-account exponential backoff in app/rate_limit.py.

Run: cd backend && python scripts/check_rate_limit_backoff.py
Fails with AssertionError if the backoff logic breaks.
"""

import os
import sys

os.environ["RATE_LIMIT_ENABLED"] = "1"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import rate_limit as rl  # noqa: E402


class _Clock:
    t = 1_000_000.0

    def time(self) -> float:
        return self.t


clock = _Clock()
rl.time = clock  # fake clock so the check is instant and deterministic

key = "login:selfcheck@example.com"
rl.clear_account_attempts(key)

# Free attempts: no delay
for _ in range(rl._BACKOFF_FREE_ATTEMPTS):
    assert rl.account_backoff_retry_after(key) == 0
    rl.record_account_attempt(key)
assert rl.account_backoff_retry_after(key) == 0

# Next failures: delay starts at base and doubles each time
expected = rl._BACKOFF_BASE_SEC
for _ in range(3):
    rl.record_account_attempt(key)
    got = rl.account_backoff_retry_after(key)
    assert got == int(expected + 0.999), f"expected ~{expected}s, got {got}s"
    clock.t += expected  # wait out the delay
    assert rl.account_backoff_retry_after(key) == 0
    expected *= 2

# Delay is capped at max (no hard lockout)
for _ in range(30):
    rl.record_account_attempt(key)
assert rl.account_backoff_retry_after(key) == int(rl._BACKOFF_MAX_SEC + 0.999)

# Success clears the counter
rl.clear_account_attempts(key)
assert rl.account_backoff_retry_after(key) == 0

# Idle accounts are forgotten
rl.record_account_attempt(key)
for _ in range(5):
    rl.record_account_attempt(key)
clock.t += rl._BACKOFF_FORGET_SEC + 1
assert rl.account_backoff_retry_after(key) == 0

print("OK: exponential backoff self-check passed")
