// @arch docs/features/agent-native-capabilities.md
// @test src/__tests__/capability-draft.test.ts

export function appendCapabilityInvocation(draft: string, invocation: string): string {
  const separator = draft.length > 0 && !/\s$/.test(draft) ? ' ' : ''
  return `${draft}${separator}${invocation} `
}
