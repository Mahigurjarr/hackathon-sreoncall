import time
from collections import OrderedDict

# Hard ceiling on distinct buckets this process will hold, regardless of how
# many distinct keys `allow()` is called with. Without this, a caller that
# can vary its key for free (see main.py's `_rate_limit_key` — the bearer
# token itself is never a safe key, since it's unverified at this layer) can
# grow `_buckets` without bound. Evicting least-recently-used keeps memory
# flat under that kind of pressure instead of leaking one entry per attempt.
_MAX_BUCKETS = 10_000


class RateLimiter:
    """Per-key token bucket. Not thread-safe across OS threads — fine here,
    since a single asyncio worker never interleaves this read-modify-write
    across an `await` point, and each pod/worker having independent state is
    an accepted v1 limitation (see repo plan doc)."""

    def __init__(self, capacity: int, refill_per_second: float, max_buckets: int = _MAX_BUCKETS) -> None:
        self._capacity = capacity
        self._refill_per_second = refill_per_second
        self._max_buckets = max_buckets
        self._buckets: "OrderedDict[str, tuple[float, float]]" = OrderedDict()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        if key in self._buckets:
            tokens, last = self._buckets.pop(key)
        else:
            tokens, last = float(self._capacity), now
            if len(self._buckets) >= self._max_buckets:
                self._buckets.popitem(last=False)  # evict the least-recently-used bucket

        tokens = min(self._capacity, tokens + (now - last) * self._refill_per_second)
        allowed = tokens >= 1
        self._buckets[key] = (tokens - 1 if allowed else tokens, now)
        return allowed

    def bucket_count(self) -> int:
        return len(self._buckets)
