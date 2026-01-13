/**
 * Effect.ts Integration for Pipeline Robustness
 *
 * Provides retry logic with exponential backoff, rate limiting,
 * and error handling for LLM API calls.
 */

import { Effect, Schedule, Duration, Semaphore, Ref, pipe } from 'effect';

// ============================================================================
// Types
// ============================================================================

/** Error types for pipeline operations */
export class RateLimitError extends Error {
  readonly _tag = 'RateLimitError';
  constructor(
    message: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class APIError extends Error {
  readonly _tag = 'APIError';
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export class TimeoutError extends Error {
  readonly _tag = 'TimeoutError';
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export type PipelineError = RateLimitError | APIError | TimeoutError;

/** Configuration for retry behavior */
export interface RetryConfig {
  /** Initial delay for exponential backoff */
  baseDelay: Duration.DurationInput;
  /** Maximum delay between retries */
  maxDelay: Duration.DurationInput;
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Factor for exponential backoff (default: 2) */
  factor?: number;
}

/** Configuration for rate limiting */
export interface RateLimitConfig {
  /** Maximum concurrent requests */
  concurrency: number;
  /** Minimum delay between requests (ms) */
  minDelayMs: number;
}

/** Default configurations */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  baseDelay: '1 second',
  maxDelay: '30 seconds',
  maxAttempts: 5,
  factor: 2,
};

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  concurrency: 3,
  minDelayMs: 200,
};

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Create a retry schedule with exponential backoff.
 */
export function createRetrySchedule(config: RetryConfig = DEFAULT_RETRY_CONFIG) {
  return pipe(
    Schedule.exponential(config.baseDelay, config.factor ?? 2),
    Schedule.either(Schedule.spaced(config.maxDelay)),
    Schedule.upTo(config.maxDelay),
    Schedule.intersect(Schedule.recurs(config.maxAttempts))
  );
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RateLimitError) {
    return true;
  }
  if (error instanceof APIError) {
    return error.isRetryable;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Common retryable error patterns
    return (
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('503') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('network')
    );
  }
  return false;
}

/**
 * Wrap an async operation with retry logic.
 */
export function withRetry<A>(
  operation: () => Promise<A>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Effect.Effect<A, PipelineError> {
  const schedule = createRetrySchedule(config);

  return pipe(
    Effect.tryPromise({
      try: operation,
      catch: (error) => classifyError(error),
    }),
    Effect.retry({
      schedule,
      while: (error) => isRetryableError(error),
    })
  );
}

/**
 * Classify an error into a PipelineError type.
 */
export function classifyError(error: unknown): PipelineError {
  if (error instanceof RateLimitError || error instanceof APIError || error instanceof TimeoutError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('rate limit') || message.includes('429')) {
      return new RateLimitError(error.message);
    }

    if (message.includes('timeout')) {
      return new TimeoutError(error.message);
    }

    // Check for HTTP status codes
    const statusMatch = message.match(/status[:\s]*(\d{3})/i);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      const isRetryable = status === 429 || status >= 500;
      return new APIError(error.message, status, isRetryable);
    }

    return new APIError(error.message, undefined, isRetryableError(error));
  }

  return new APIError(String(error));
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Rate limiter for controlling API call concurrency and frequency.
 */
export interface RateLimiter {
  /** Execute an effect with rate limiting */
  withRateLimit: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  /** Get current concurrent count */
  getConcurrentCount: () => Effect.Effect<number>;
}

/**
 * Create a rate limiter with concurrency and delay controls.
 */
export function createRateLimiter(
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): Effect.Effect<RateLimiter, never> {
  return Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(config.concurrency);
    const lastCallTime = yield* Ref.make(0);
    const concurrentCount = yield* Ref.make(0);

    const withRateLimit = <A, E>(
      effect: Effect.Effect<A, E>
    ): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        // Wait for semaphore permit
        yield* Ref.update(concurrentCount, (n) => n + 1);

        try {
          // Enforce minimum delay between requests
          const now = Date.now();
          const lastTime = yield* Ref.get(lastCallTime);
          const elapsed = now - lastTime;

          if (elapsed < config.minDelayMs) {
            yield* Effect.sleep(Duration.millis(config.minDelayMs - elapsed));
          }

          // Execute with permit
          const result = yield* semaphore.withPermits(1)(effect);

          // Update last call time
          yield* Ref.set(lastCallTime, Date.now());

          return result;
        } finally {
          yield* Ref.update(concurrentCount, (n) => n - 1);
        }
      });

    const getConcurrentCount = () => Ref.get(concurrentCount);

    return {
      withRateLimit,
      getConcurrentCount,
    };
  });
}

// ============================================================================
// Effect Pipeline Wrappers
// ============================================================================

/**
 * Wrap an LLM API call with retry and rate limiting.
 */
export function withRobustness<A>(
  operation: () => Promise<A>,
  options: {
    retryConfig?: RetryConfig;
    rateLimiter?: RateLimiter;
    timeout?: Duration.DurationInput;
  } = {}
): Effect.Effect<A, PipelineError> {
  const {
    retryConfig = DEFAULT_RETRY_CONFIG,
    rateLimiter,
    timeout = '60 seconds',
  } = options;

  let effect = withRetry(operation, retryConfig);

  // Add timeout
  effect = pipe(
    effect,
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () => new TimeoutError(`Operation timed out after ${timeout}`),
    })
  );

  // Add rate limiting if provided
  if (rateLimiter) {
    effect = rateLimiter.withRateLimit(effect);
  }

  return effect;
}

/**
 * Run an Effect and convert to Promise (for integration with existing code).
 */
export async function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, never>);
}

/**
 * Process items with controlled concurrency and retry.
 */
export function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: {
    concurrency?: number;
    retryConfig?: RetryConfig;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Effect.Effect<R[], PipelineError> {
  const {
    concurrency = 3,
    retryConfig = DEFAULT_RETRY_CONFIG,
    onProgress,
  } = options;

  return Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(concurrency);
    const completedRef = yield* Ref.make(0);
    const total = items.length;

    const processItem = (item: T, index: number): Effect.Effect<R, PipelineError> =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          const result = yield* withRetry(() => processor(item, index), retryConfig);

          // Update progress
          const completed = yield* Ref.updateAndGet(completedRef, (n) => n + 1);
          onProgress?.(completed, total);

          return result;
        })
      );

    // Process all items with controlled concurrency
    const results = yield* Effect.all(
      items.map((item, index) => processItem(item, index)),
      { concurrency: 'unbounded' } // Semaphore handles actual concurrency
    );

    return results;
  });
}

// ============================================================================
// Progress Tracking
// ============================================================================

export interface ProgressTracker {
  /** Update progress */
  update: (current: number, total: number, status?: string) => void;
  /** Get current progress */
  getProgress: () => { current: number; total: number; status: string };
}

/**
 * Create a progress tracker Effect.
 */
export function createProgressTracker(
  onProgress?: (status: string, current: number, total: number) => void
): Effect.Effect<ProgressTracker> {
  return Effect.gen(function* () {
    const state = yield* Ref.make({ current: 0, total: 100, status: '' });

    return {
      update: (current: number, total: number, status?: string) => {
        const statusStr = status ?? '';
        Ref.set(state, { current, total, status: statusStr });
        onProgress?.(statusStr, current, total);
      },
      getProgress: () => Effect.runSync(Ref.get(state)),
    };
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Run effects in sequence with optional delay between them.
 */
export function sequenceWithDelay<A, E>(
  effects: Effect.Effect<A, E>[],
  delayMs: number = 0
): Effect.Effect<A[], E> {
  return Effect.gen(function* () {
    const results: A[] = [];

    for (let i = 0; i < effects.length; i++) {
      if (i > 0 && delayMs > 0) {
        yield* Effect.sleep(Duration.millis(delayMs));
      }
      const result = yield* effects[i];
      results.push(result);
    }

    return results;
  });
}

/**
 * Batch items and process batches with delay between them.
 */
export function processBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>,
  options: {
    delayBetweenBatches?: number;
    retryConfig?: RetryConfig;
    onBatchComplete?: (batchNum: number, totalBatches: number) => void;
  } = {}
): Effect.Effect<R[], PipelineError> {
  const {
    delayBetweenBatches = 500,
    retryConfig = DEFAULT_RETRY_CONFIG,
    onBatchComplete,
  } = options;

  return Effect.gen(function* () {
    const results: R[] = [];
    const batches: T[][] = [];

    // Create batches
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    const totalBatches = batches.length;

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      if (i > 0 && delayBetweenBatches > 0) {
        yield* Effect.sleep(Duration.millis(delayBetweenBatches));
      }

      const batchResults = yield* withRetry(
        () => processor(batches[i]),
        retryConfig
      );

      results.push(...batchResults);
      onBatchComplete?.(i + 1, totalBatches);
    }

    return results;
  });
}

// ============================================================================
// Exports
// ============================================================================

export {
  Effect,
  Schedule,
  Duration,
  Semaphore,
  pipe,
};
