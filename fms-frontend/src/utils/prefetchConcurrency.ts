/** Limits idle route prefetch so background warming does not compete with active page loads. */
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
