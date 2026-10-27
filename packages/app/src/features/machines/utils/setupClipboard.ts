// @arch docs/features/agent-provider-config.md
// @test src/__tests__/machine-agent-install.test.ts
export async function copySetupText(
  text: string,
  write: (text: string) => Promise<boolean>,
): Promise<'copied' | 'failed'> {
  try {
    return (await write(text)) ? 'copied' : 'failed'
  } catch {
    return 'failed'
  }
}
