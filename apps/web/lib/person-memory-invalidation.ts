/** Same-page invalidation only; a notification never supplies Memory content. */
type Listener = (binding: string, personId: string) => void;
const listeners = new Set<Listener>();

export function invalidatePersonMemory(binding: string, personId: string): void {
  for (const listener of [...listeners]) listener(binding, personId);
}

export function subscribePersonMemoryInvalidation(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
