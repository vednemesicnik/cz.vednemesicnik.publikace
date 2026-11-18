/**
 * One step at a time per key. Two clicks, two people, or a second request while the first is still
 * on Drive would otherwise each see the same thing missing and each create it. The app is one
 * process on one machine, so a lock in memory is the whole of it.
 */
export function createLock(): <T>(key: string, run: () => Promise<T>) => Promise<T> {
  let running = new Map<string, Promise<unknown>>()

  return async (key, run) => {
    let previous = running.get(key) ?? Promise.resolve()
    let current = previous.then(run, run)
    let settled = current.catch(() => undefined)
    running.set(key, settled)
    try {
      return await current
    } finally {
      if (running.get(key) === settled) running.delete(key)
    }
  }
}
