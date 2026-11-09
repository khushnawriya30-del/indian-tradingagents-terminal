interface CacheEntry<T> {
  value: T;
  expires: number;
}

const memory = new Map<string, CacheEntry<any>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.expires > now) {
    return hit.value as T;
  }
  const fresh = await compute();
  memory.set(key, { value: fresh, expires: now + ttlMs });
  return fresh;
}
