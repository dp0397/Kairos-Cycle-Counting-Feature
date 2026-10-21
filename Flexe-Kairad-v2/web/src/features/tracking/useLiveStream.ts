import { useEffect, useRef } from 'react';
import { getToken } from '../../api/client';

/** Subscribes to the server SSE stream (telemetry, asset moves, alerts). EventSource auto-reconnects. */
export function useLiveStream(warehouseId: string | undefined, onEvent: (type: string, data: any) => void) {
  const cb = useRef(onEvent); cb.current = onEvent;
  useEffect(() => {
    if (!warehouseId) return;
    const es = new EventSource(`/api/v1/telemetry/stream?token=${getToken()}&warehouseId=${warehouseId}`);
    for (const t of ['telemetry', 'asset.moved', 'alert']) es.addEventListener(t, (e) => cb.current(t, JSON.parse((e as MessageEvent).data)));
    return () => es.close();
  }, [warehouseId]);
}
