/** Limits idle route prefetch so login does not flood the API (Render cold start + DB). */
const MAX_CONCURRENT = 2
let active = 0
const queue: Array<() => void> = []

export function runPrefetchLimited(run: () => Promise<unknown>): void {
  const start = () => {
    active += 1
    void run().finally(() => {
      active -= 1
      const next = queue.shift()
      if (next) next()
    })
  }
  if (active < MAX_CONCURRENT) start()
  else queue.push(start)
}
