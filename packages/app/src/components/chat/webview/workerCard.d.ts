// @arch docs/features/manager-agent.md#九manager-与-worker-的可见-markdown
export interface WorkerCard {
  href: string
  label: string
  title: string
  kind: 'created' | 'completed' | 'progress' | 'message' | 'failed' | 'stopped'
  preview: string
}
export function parseWorkerCard(content: string): WorkerCard | null
export function workerCardInnerHtml(card: WorkerCard): string
