// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-schedule.test.ts
export type PendingReminder = {
  key: string
  text: string
  timezone: string
  parsed?: { content: string; when: string; timezone: string }
}
type Request = <T>(path: string, init: { method: string; body: string }) => Promise<T>
// Keep the key and parsed time across uncertain retries, including relative dates.
export async function createCloudReminder(
  pending: PendingReminder,
  request: Request,
  isCurrent: () => boolean,
) {
  const path = '/personal-modules/reminders'
  if (!pending.parsed) {
    pending.parsed = await request(`${path}/preview`, {
      method: 'POST',
      body: JSON.stringify({ text: pending.text, timezone: pending.timezone }),
    })
  }
  if (!isCurrent()) throw new Error('account_changed')
  return request(`${path}/${encodeURIComponent(pending.key)}`, {
    method: 'POST',
    body: JSON.stringify(pending.parsed),
  })
}
