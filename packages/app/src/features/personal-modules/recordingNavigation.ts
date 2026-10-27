// @arch docs/features/listening.md
// @test src/__tests__/recording-day-list.test.ts
export type RecordingView = 'home' | 'days' | 'day' | 'settings'
/** Separate native-stack entries, so Back/swipe returns to the actual origin. */
export function recordingDestination(view: RecordingView, day: string) {
  return {
    pathname: '/(main)/personal-modules' as const,
    params: { tab: 'recording', recordingView: view, recordingDay: day, __mobileEntry: 'push' },
  }
}
