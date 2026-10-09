import { useCallback, useEffect, useState } from 'react';

const storageKey = 'mail-connect-retry-at';
const cooldownEvent = 'mail-connect-cooldown';

export function mailRetryDeadline(retryAfterSeconds: unknown, retryAfter: string | null, now = Date.now()): number {
  const seconds = Number(retryAfterSeconds ?? retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return now + Math.ceil(seconds) * 1000;
  const date = retryAfter ? Date.parse(retryAfter) : NaN;
  return Number.isFinite(date) && date > now ? date : now + 15 * 60 * 1000;
}

function readDeadline() {
  try {
    const stored = Number(sessionStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > Date.now() ? stored : 0;
  } catch {
    return 0;
  }
}

export function useMailConnectionCooldown() {
  const [deadline, setDeadline] = useState(readDeadline);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const sync = (event: Event) => {
      setDeadline((event as CustomEvent<number>).detail);
      setNow(Date.now());
    };
    window.addEventListener(cooldownEvent, sync);
    return () => window.removeEventListener(cooldownEvent, sync);
  }, []);

  useEffect(() => {
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const applyCooldown = useCallback((response: Response, body: { retryAfterSeconds?: unknown }) => {
    if (response.status !== 429) return;
    const next = mailRetryDeadline(body.retryAfterSeconds, response.headers.get('Retry-After'));
    // Preserve the server cooldown when switching forms or reloading this tab.
    try { sessionStorage.setItem(storageKey, String(next)); } catch { /* Storage may be disabled. */ }
    window.dispatchEvent(new CustomEvent(cooldownEvent, { detail: next }));
  }, []);

  return { retryAfterSeconds: Math.max(0, Math.ceil((deadline - now) / 1000)), applyCooldown };
}
