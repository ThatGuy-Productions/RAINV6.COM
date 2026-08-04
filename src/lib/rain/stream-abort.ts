/** SEC-M1 — Stream byte-counting abort for Next.js route bodies */
export class StreamByteCounter {
  private count = 0;
  constructor(private maxBytes: number) {}
  feed(chunk: Uint8Array) {
    this.count += chunk.byteLength;
    if (this.count > this.maxBytes) throw new Error(`Upload exceeds ${this.maxBytes} bytes (SEC-M1)`);
  }
  get count() { return this.count; }
}
