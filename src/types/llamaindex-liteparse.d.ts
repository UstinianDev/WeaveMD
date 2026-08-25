declare module '@llamaindex/liteparse' {
  export class LlamaParseReader {
    constructor(options?: Record<string, unknown>);
    loadDataAsContent(data: Uint8Array): Promise<Array<{ text: string }>>;
  }
}
