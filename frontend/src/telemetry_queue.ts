export interface TelemetryEvent {
  eventId: string;
  exceptionType: string;
  moduleName: string;
  timestamp: number;
  patchApplied: boolean;
}

export class RingBufferTelemetryQueue {
  private buffer: TelemetryEvent[];
  private capacity: number;
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;

  constructor(capacity: number = 1000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  public enqueue(event: TelemetryEvent): boolean {
    if (this.size === this.capacity) {
      // Overwrite oldest entry to guarantee memory limit bounded state
      this.head = (this.head + 1) % this.capacity;
      this.size--;
    }
    this.buffer[this.tail] = event;
    this.tail = (this.tail + 1) % this.capacity;
    this.size++;
    return true;
  }

  public flushBatch(batchSize: number): TelemetryEvent[] {
    const count = Math.min(batchSize, this.size);
    const batch: TelemetryEvent[] = [];
    for (let i = 0; i < count; i++) {
      batch.push(this.buffer[this.head]);
      this.head = (this.head + 1) % this.capacity;
      this.size--;
    }
    return batch;
  }
}
