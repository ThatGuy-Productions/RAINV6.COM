/** SEC-M1 — Stream byte-counting abort for Next.js route bodies */
export class StreamByteCounter {
  private _count = 0;
  constructor(private maxBytes: number) {}
  feed(chunk: Uint8Array) {
    this._count += chunk.byteLength;
    if (this._count > this.maxBytes) throw new Error(`Upload exceeds ${this.maxBytes} bytes (SEC-M1)`);
  }
  get count() { return this._count; }
}
