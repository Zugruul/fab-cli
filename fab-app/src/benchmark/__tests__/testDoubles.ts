// Deterministic in-memory fakes for the BenchmarkRunner test suite
// (APP-024, #136) — mirrors ../../retrieval/__tests__/testDoubles.ts's role
// for that module. No real llama.rn/op-sqlite/native timer runs anywhere
// here; every "duration" is a canned number from a fixed sequence so
// aggregation math (percentile/median) can be pinned against hand-computed
// expected values.

import type {
  DecodeClient,
  EmbeddingClient,
  PrefillClient,
  RamPeakSampler,
  TtftClient,
} from '../types';

/** Cycles through a fixed sequence of numbers, one per call — repeats the
 * sequence if called more times than it has entries (so a test can supply
 * exactly N values for N iterations without over-specifying warmup calls). */
class SequenceCursor {
  private index = 0;
  constructor(private readonly sequence: number[]) {
    if (sequence.length === 0) {
      throw new Error('SequenceCursor: sequence must be non-empty');
    }
  }
  next(): number {
    const value = this.sequence[this.index % this.sequence.length];
    this.index += 1;
    return value;
  }
  get callCount(): number {
    return this.index;
  }
}

export class FakeDecodeClient implements DecodeClient {
  private readonly durations: SequenceCursor;
  constructor(durationsMs: number[], private readonly tokensPerCall = 100) {
    this.durations = new SequenceCursor(durationsMs);
  }
  async decode(
    _tokenCount: number,
  ): Promise<{ durationMs: number; tokensGenerated: number }> {
    return {
      durationMs: this.durations.next(),
      tokensGenerated: this.tokensPerCall,
    };
  }
  get callCount(): number {
    return this.durations.callCount;
  }
}

export class FakePrefillClient implements PrefillClient {
  private readonly durations: SequenceCursor;
  constructor(durationsMs: number[], private readonly tokensPerCall = 1024) {
    this.durations = new SequenceCursor(durationsMs);
  }
  async prefill(
    _promptTokenCount: number,
  ): Promise<{ durationMs: number; tokensProcessed: number }> {
    return {
      durationMs: this.durations.next(),
      tokensProcessed: this.tokensPerCall,
    };
  }
  get callCount(): number {
    return this.durations.callCount;
  }
}

export class FakeTtftClient implements TtftClient {
  private readonly durations: SequenceCursor;
  constructor(durationsMs: number[]) {
    this.durations = new SequenceCursor(durationsMs);
  }
  async measureTtft(_warmSession: boolean): Promise<{ durationMs: number }> {
    return { durationMs: this.durations.next() };
  }
  get callCount(): number {
    return this.durations.callCount;
  }
}

export class FakeEmbeddingClient implements EmbeddingClient {
  private readonly durations: SequenceCursor;
  constructor(durationsMs: number[]) {
    this.durations = new SequenceCursor(durationsMs);
  }
  async embedQuery(_text: string): Promise<{ durationMs: number }> {
    return { durationMs: this.durations.next() };
  }
  get callCount(): number {
    return this.durations.callCount;
  }
}

export class FakeRamPeakSampler implements RamPeakSampler {
  private readonly samples: SequenceCursor;
  constructor(samplesBytes: number[]) {
    this.samples = new SequenceCursor(samplesBytes);
  }
  async sampleResidentMemoryBytes(): Promise<number> {
    return this.samples.next();
  }
  get callCount(): number {
    return this.samples.callCount;
  }
}
