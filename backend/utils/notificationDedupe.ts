import { createHash } from 'crypto';

export function notificationDedupeKey(userId: string, type: string, relatedId?: string | null): string | null {
  if (!relatedId) return null;
  return createHash('sha256').update(JSON.stringify([userId, type, relatedId])).digest('hex');
}
