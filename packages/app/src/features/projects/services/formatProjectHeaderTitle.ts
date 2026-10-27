// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-launch-entry.test.ts

export function formatProjectHeaderTitle(
  machineLabel: string,
  projectLabel: string,
  machineStatusLabel: string | null,
): string {
  const title = [machineLabel, projectLabel].filter(Boolean).join(' · ')
  return machineStatusLabel ? `${title}（${machineStatusLabel}）` : title
}
