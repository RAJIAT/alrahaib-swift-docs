import { useEffect, useState } from "react";
import { listRequests, subscribeRequests, type InsuranceRequest } from "@/services/api";

export function useRequestsLive(opts?: { agentId?: string }) {
  const [items, setItems] = useState<InsuranceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      listRequests(opts?.agentId ? { agentId: opts.agentId } : undefined).then((rs) => {
        if (!alive) return;
        setItems(rs);
        setLoading(false);
      });
    };
    refresh();
    const unsub = subscribeRequests(refresh);
    return () => { alive = false; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.agentId]);

  return { items, loading };
}
