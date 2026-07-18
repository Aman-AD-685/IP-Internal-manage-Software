/** Minimal assert: shared status colours stay consistent for D2. */
import { getStatusTagColor } from '../src/utils/statusColors'

const cases: Array<[string | null | undefined, string]> = [
  ['pending', 'orange'],
  ['Pending', 'orange'],
  ['completed', 'green'],
  ['staging', 'blue'],
  ['hold', 'gold'],
  ['rejected', 'red'],
  ['unapproved', 'orange'],
  ['approved', 'green'],
  ['open', 'blue'],
  ['in_progress', 'blue'],
  ['in-progress', 'blue'],
  ['resolved', 'green'],
  ['cancelled', 'default'],
  ['on_hold', 'gold'],
  [null, 'default'],
  ['-', 'default'],
  ['unknown-xyz', 'default'],
]

for (const [input, expected] of cases) {
  const got = getStatusTagColor(input)
  if (got !== expected) {
    throw new Error(`getStatusTagColor(${JSON.stringify(input)}) => ${got}, expected ${expected}`)
  }
}

console.log('ok: statusColors D2 map covers stage/lifecycle/approval statuses')
