import { useEffect, useRef, useState } from "react";
import { listRequests, subscribeRequests, type InsuranceRequest } from "@/services/api";

// Poll frequently so newly submitted customer requests show up almost
// immediately on agent / supervisor / admin dashboards without manual refresh.
const POLL_INTERVAL_MS = 4_000;

// Module-level cache keyed by filter. Keeps the last known list visible when
// the hook remounts (e.g. after returning from the request-details page) so
// the dashboard never flashes an empty / zero state during the refetch.
const listCache = new Map<string, { items: InsuranceRequest[]; sig: string; at: number }>();
const CACHE_FRESH_MS = 3_000;

function cacheKey(agentId?: string, branch?: string) {
  return `${agentId ?? ""}|${branch ?? ""}`;
}

function requestSig(r: Partial<InsuranceRequest> | null | undefined): string {
  const images = r?.images ?? {
    registration: [],
    license: [],
    emirates: [],
    vehicleMedia: [],
    attachments: [],
  };
  const imageCount =
    (Array.isArray(images.registration) ? images.registration.length : 0) +
    (Array.isArray(images.license) ? images.license.length : 0) +
    (Array.isArray(images.emirates) ? images.emirates.length : 0) +
    (Array.isArray(images.vehicleMedia) ? images.vehicleMedia.length : 0) +
    (Array.isArray(images.attachments) ? images.attachments.length : 0) +
    (Array.isArray(images.missingAttachments) ? images.missingAttachments.length : 0) +
    (images.inspection ? 1 : 0) +
    (r?.quotes?.length ?? 0);
  return `${r?.id ?? ""}:${r?.status ?? "new"}:${r?.assignedAt ?? ""}:${imageCount}:${r?.notes?.length ?? 0}`;
}

export function useRequestsLive(opts?: { agentId?: string; branch?: string }) {
  const agentId = opts?.agentId;
  const branch = opts?.branch;
  const wantsScoped = opts !== undefined;
  const key = cacheKey(agentId, branch);
  const cached = listCache.get(key);

  const [items, setItems] = useState<InsuranceRequest[]>(() => cached?.items ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const sigRef = useRef<string>(cached?.sig ?? "");

  useEffect(() => {
    let alive = true;
    // If a filter object was provided but it has no agentId/branch, treat as
    // "not ready yet" — never list ALL requests by accident from a dashboard
    // that's supposed to be scoped to one agent or branch.
    const ready = !wantsScoped || !!agentId || !!branch;
    if (!ready) {
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    const refresh = () => {
      const filter: { agentId?: string; branch?: string } = {};
      if (agentId) filter.agentId = agentId;
      if (branch) filter.branch = branch;
      listRequests(Object.keys(filter).length ? filter : undefined)
        .then((rs) => {
          if (!alive) return;
          const safeRows = Array.isArray(rs) ? rs.filter(Boolean) : [];
          setError(null);
          // Include file/note counts too, so customer uploads update open dashboards without refresh.
          const sig = `${safeRows.length}|` + safeRows.map(requestSig).join(",");
          if (sig !== sigRef.current) {
            sigRef.current = sig;
            setItems(safeRows as InsuranceRequest[]);
          }
          listCache.set(key, { items: safeRows as InsuranceRequest[], sig, at: Date.now() });
          setLoading(false);
        })
        .catch((e) => {
          if (!alive) return;
          console.error("listRequests failed", e);
          setError(e instanceof Error ? e.message : "Failed to load");
          setLoading(false);
        });
    };

    // If cache is fresh, skip the immediate refetch — polling still updates it.
    const fresh = cached && Date.now() - cached.at < CACHE_FRESH_MS;
    if (fresh) {
      setLoading(false);
    } else {
      refresh();
    }
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
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
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
  }, [agentId, branch, wantsScoped]);

  return { items, loading, error };
}
