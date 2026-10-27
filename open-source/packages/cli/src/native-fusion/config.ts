// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-config.test.ts

export function isNativeFusionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHENNIAN_NATIVE_FUSION_DISABLED !== '1'
}
