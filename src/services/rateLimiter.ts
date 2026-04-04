const MAX_ATTEMPTS = 10;
const BAN_DURATION = 30 * 60 * 1000; // 30 นาที

interface AttemptRecord {
  count: number;
  firstAt: number;
  lastAt: number;
  bannedUntil: number;
  groupId: string;
}

const store = new Map<string, AttemptRecord>();

export function getClientIp(req: any): string {
  return (
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-real-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

export function isBanned(ip: string): boolean {
  const rec = store.get(ip);
  if (!rec) return false;
  if (rec.bannedUntil && Date.now() < rec.bannedUntil) return true;
  return false;
}

export function recordFailure(ip: string, groupId: string): { banned: boolean; attemptsLeft: number } {
  const now = Date.now();
  const rec = store.get(ip) || { count: 0, firstAt: now, lastAt: now, bannedUntil: 0, groupId };
  rec.count++;
  rec.lastAt = now;
  rec.groupId = groupId;
  if (rec.count >= MAX_ATTEMPTS && !rec.bannedUntil) {
    rec.bannedUntil = now + BAN_DURATION;
  }
  store.set(ip, rec);
  return {
    banned: rec.bannedUntil > 0 && Date.now() < rec.bannedUntil,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - rec.count),
  };
}

export function clearFailures(ip: string) {
  store.delete(ip);
}

export function unbanIp(ip: string) {
  store.delete(ip);
}

export function getSecurityLog(): Array<{
  ip: string; count: number; groupId: string;
  banned: boolean; bannedUntil: number; firstAt: number; lastAt: number; remainingMs: number;
}> {
  const now = Date.now();
  return Array.from(store.entries())
    .map(([ip, rec]) => ({
      ip,
      count: rec.count,
      groupId: rec.groupId,
      banned: rec.bannedUntil > 0 && now < rec.bannedUntil,
      bannedUntil: rec.bannedUntil,
      firstAt: rec.firstAt,
      lastAt: rec.lastAt,
      remainingMs: Math.max(0, rec.bannedUntil - now),
    }))
    .sort((a, b) => b.lastAt - a.lastAt);
}
