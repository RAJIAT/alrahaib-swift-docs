import { useEffect, useRef, useState } from "react";
import { listRequests, subscribeRequests, type InsuranceRequest } from "@/services/api";

const POLL_INTERVAL_MS = 8_000;

export function useRequestsLive(opts?: { agentId?: string; branch?: string }) {
  const [items, setItems] = useState<InsuranceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sigRef = useRef<string>("");

  const agentId = opts?.agentId;
  const branch = opts?.branch;

  useEffect(() => {
    let alive = true;
    // If a filter object was provided but it has no agentId/branch, treat as
    // "not ready yet" — never list ALL requests by accident from a dashboard
    // that's supposed to be scoped to one agent or branch.
    const wantsScoped = opts !== undefined;
    const ready = !wantsScoped || !!agentId || !!branch;
    if (!ready) {
      setLoading(false);
      return () => { alive = false; };
    }

    const refresh = () => {
      const filter: { agentId?: string; branch?: string } = {};
      if (agentId) filter.agentId = agentId;
      if (branch) filter.branch = branch;
      listRequests(Object.keys(filter).length ? filter : undefined)
        .then((rs) => {
          if (!alive) return;
          setError(null);
          // Cheap signature: length + ids+statuses concatenated. Skips state update if nothing changed.
          const sig = `${rs.length}|` + rs.map((r) => `${r.id}:${r.status}`).join(",");
          if (sig !== sigRef.current) {
            sigRef.current = sig;
            setItems(rs);
          }
          setLoading(false);
        })
        .catch((e) => {
          if (!alive) return;
          console.error("listRequests failed", e);
          setError(e instanceof Error ? e.message : "Failed to load");
          setLoading(false);
        });
    };

    refresh();
    const unsub = subscribeRequests(refresh);

    // Polling so new requests submitted by customers (other tabs / devices)
    // appear without requiring the user to manually refresh the page.
    // Pauses while the tab is hidden to avoid wasted requests.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        refresh();
      }, POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    };
    startPolling();

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (!document.hidden) refresh(); // immediate catch-up when tab returns
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      alive = false;
      unsub();
      stopPolling();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [agentId, branch, opts]);

  return { items, loading, error };
}
