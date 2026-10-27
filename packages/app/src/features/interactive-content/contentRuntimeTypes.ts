// @arch docs/architecture/interactive-web-agent-and-versioning.md
export type RuntimeObservation = { text: string; controls: Array<{ name: string; type: string; value: string }>; methods?: Array<{ name: string; description: string; parameters: Record<string, unknown> }> }
export type ContentCanvasHandle = { observe(part?: 'state' | 'methods'): Promise<RuntimeObservation>; invoke(name: string, args: Record<string, unknown>): Promise<void> }

export type ContentSaveMetadata = { title: string; summary: string; changeSummary: string }
