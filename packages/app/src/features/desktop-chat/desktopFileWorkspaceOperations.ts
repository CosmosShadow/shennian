// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-file-workspace-operations.test.ts

export type DesktopFileOperationLane = 'directory' | 'preview' | 'download' | 'reveal'

/** Keeps late file responses from mutating a closed preview or a replacement account/session. */
export class DesktopFileWorkspaceOperations {
  private generation = 0
  private readonly lanes: Record<DesktopFileOperationLane, number> = {
    directory: 0,
    preview: 0,
    download: 0,
    reveal: 0,
  }

  begin(lane: DesktopFileOperationLane): { generation: number; lane: DesktopFileOperationLane; id: number } {
    const id = this.lanes[lane] + 1
    this.lanes[lane] = id
    return { generation: this.generation, lane, id }
  }

  isCurrent(operation: { generation: number; lane: DesktopFileOperationLane; id: number }): boolean {
    return operation.generation === this.generation && this.lanes[operation.lane] === operation.id
  }

  invalidateLane(lane: DesktopFileOperationLane): void {
    this.lanes[lane] += 1
  }

  invalidateAll(): void {
    this.generation += 1
    for (const lane of Object.keys(this.lanes) as DesktopFileOperationLane[]) this.lanes[lane] = 0
  }
}
