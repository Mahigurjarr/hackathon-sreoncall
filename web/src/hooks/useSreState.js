import { useCallback, useEffect, useRef, useState } from "react";
import { getState } from "@/lib/api";

// Polls the backend on an interval so the dashboard reflects the daemon's own
// unprompted sweeps without a manual refresh — the whole point of Agency is that
// the agent acts on its own, so the UI watching it should too.
// react-best-practices: functional setState (rerender-functional-setstate) so this
// effect's closure never goes stale, and the interval itself never depends on state.
export function useSreState(pollMs = 5000) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer;

    async function tick() {
      try {
        const next = await getState();
        if (mounted.current) {
          setState(next);
          setError(null);
        }
      } catch (err) {
        if (mounted.current) setError(err.message);
      } finally {
        if (mounted.current) timer = setTimeout(tick, pollMs);
      }
    }

    tick();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [pollMs]);

  // Pulls once, immediately. An approve/revise/reject changes state on the backend the
  // instant it returns; waiting out the poll interval would make the UI look like it
  // ignored the click.
  const refresh = useCallback(async () => {
    const next = await getState();
    if (mounted.current) {
      setState(next);
      setError(null);
    }
    return next;
  }, []);

  return { state, error, loading: state === null && error === null, refresh };
}
