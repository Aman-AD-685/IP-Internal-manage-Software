/** Fired when a Chores & Bugs Stage 2 remark is added — refresh header bell. */
export const STAGE2_REMARK_ADDED_EVENT = 'fms:stage2-remark-added'

export function notifyStage2RemarkAdded(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STAGE2_REMARK_ADDED_EVENT))
}
