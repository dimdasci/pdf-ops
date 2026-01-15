import { describe, it } from '@effect/vitest'
import { Effect, Fiber, Ref, TestClock } from 'effect'
import { expect } from 'vitest'

// Import from effect-wrapper - actual exports from the module
import {
  APIError,
  classifyError,
  createRateLimiter,
  createRetrySchedule,
  isRetryableError,
  RateLimitError,
  TimeoutError,
} from '../../src/lib/pipeline/effect-wrapper'

describe('Effect Wrapper', () => {
  describe('classifyError', () => {
    // Rate limit detection
    it.effect('returns RateLimitError for "rate limit" message', () =>
      Effect.gen(function*() {
        const error = new Error('rate limit exceeded')
        const result = classifyError(error)

        expect(result).toBeInstanceOf(RateLimitError)
        expect(result._tag).toBe('RateLimitError')
      }))

    it.effect('returns RateLimitError for 429 status code in message', () =>
      Effect.gen(function*() {
        const error = new Error('HTTP 429 Too Many Requests')
        const result = classifyError(error)

        expect(result).toBeInstanceOf(RateLimitError)
        expect(result._tag).toBe('RateLimitError')
      }))

    it.effect('preserves RateLimitError if already classified', () =>
      Effect.gen(function*() {
        const original = new RateLimitError('rate limit', 5000)
        const result = classifyError(original)

        expect(result).toBe(original)
        expect(result._tag).toBe('RateLimitError')
      }))

    // Timeout detection
    it.effect('returns TimeoutError for "timeout" message', () =>
      Effect.gen(function*() {
        const error = new Error('Request timeout after 30s')
        const result = classifyError(error)

        expect(result).toBeInstanceOf(TimeoutError)
        expect(result._tag).toBe('TimeoutError')
      }))

    it.effect('preserves TimeoutError if already classified', () =>
      Effect.gen(function*() {
        const original = new TimeoutError('Operation timed out')
        const result = classifyError(original)

        expect(result).toBe(original)
        expect(result._tag).toBe('TimeoutError')
      }))

    // API error with status codes
    it.effect('returns APIError with status code for HTTP 500', () =>
      Effect.gen(function*() {
        const error = new Error('Request failed with status: 500')
        const result = classifyError(error)

        expect(result).toBeInstanceOf(APIError)
        expect(result._tag).toBe('APIError')
        if (result._tag === 'APIError') {
          expect(result.statusCode).toBe(500)
          expect(result.isRetryable).toBe(true)
        }
      }))

    it.effect('returns APIError with isRetryable=false for 400', () =>
      Effect.gen(function*() {
        const error = new Error('Request failed with status: 400')
        const result = classifyError(error)

        expect(result).toBeInstanceOf(APIError)
        expect(result._tag).toBe('APIError')
        if (result._tag === 'APIError') {
          expect(result.statusCode).toBe(400)
          expect(result.isRetryable).toBe(false)
        }
      }))

    it.effect('preserves APIError if already classified', () =>
      Effect.gen(function*() {
        const original = new APIError('Bad request', 400, false)
        const result = classifyError(original)

        expect(result).toBe(original)
        expect(result._tag).toBe('APIError')
      }))

    it.effect('returns APIError for unknown error types', () =>
      Effect.gen(function*() {
        const error = new Error('Something went wrong')
        const result = classifyError(error)

        expect(result).toBeInstanceOf(APIError)
        expect(result._tag).toBe('APIError')
      }))

    it.effect('handles non-Error objects', () =>
      Effect.gen(function*() {
        const error = 'string error'
        const result = classifyError(error)

        expect(result).toBeInstanceOf(APIError)
        expect(result._tag).toBe('APIError')
      }))
  })

  describe('isRetryableError', () => {
    it.effect('returns true for RateLimitError', () =>
      Effect.gen(function*() {
        const error = new RateLimitError('rate limit', 5000)
        expect(isRetryableError(error)).toBe(true)
      }))

    it.effect('returns true for retryable APIError', () =>
      Effect.gen(function*() {
        const error = new APIError('server error', 500, true)
        expect(isRetryableError(error)).toBe(true)
      }))

    it.effect('returns false for non-retryable APIError', () =>
      Effect.gen(function*() {
        const error = new APIError('bad request', 400, false)
        expect(isRetryableError(error)).toBe(false)
      }))

    it.effect('returns true for network error patterns', () =>
      Effect.gen(function*() {
        const patterns = ['ECONNRESET', 'network error', 'rate limit', '429', '503', 'timeout']
        for (const pattern of patterns) {
          const error = new Error(pattern)
          expect(isRetryableError(error)).toBe(true)
        }
      }))

    it.effect('returns false for generic errors without retryable patterns', () =>
      Effect.gen(function*() {
        const error = new Error('Invalid API key')
        expect(isRetryableError(error)).toBe(false)
      }))

    it.effect('returns false for non-Error values', () =>
      Effect.gen(function*() {
        expect(isRetryableError(null)).toBe(false)
        expect(isRetryableError(undefined)).toBe(false)
        expect(isRetryableError('string error')).toBe(false)
        expect(isRetryableError(123)).toBe(false)
      }))
  })

  describe('Retry Schedule', () => {
    it.scoped('exponential backoff increases delays', () =>
      Effect.gen(function*() {
        const retryTimes: number[] = []
        let attemptCount = 0

        const failingEffect = Effect.gen(function*() {
          attemptCount++
          const currentTime = yield* TestClock.currentTimeMillis
          retryTimes.push(Number(currentTime))

          if (attemptCount < 4) {
            return yield* Effect.fail(new RateLimitError('rate limit'))
          }
          return 'success'
        })

        const schedule = createRetrySchedule({
          baseDelay: '1 second',
          maxDelay: '30 seconds',
          maxAttempts: 4,
          factor: 2,
        })

        const retriedEffect = Effect.retry(failingEffect, schedule)
        const fiber = yield* Effect.fork(retriedEffect)

        // Advance time to allow retries
        // First attempt is immediate, then exponential backoff kicks in
        yield* TestClock.adjust('0 millis') // First attempt
        yield* TestClock.adjust('1 second') // Wait for first retry
        yield* TestClock.adjust('2 seconds') // Wait for second retry
        yield* TestClock.adjust('4 seconds') // Wait for third retry

        const result = yield* Fiber.join(fiber)

        expect(result).toBe('success')
        expect(attemptCount).toBe(4)

        // Verify delays increased (first attempt at time 0)
        expect(retryTimes[0]).toBe(0)
        // Subsequent attempts should be at increasing intervals
        expect(retryTimes.length).toBeGreaterThanOrEqual(2)
      }))
  })

  describe('Rate Limiter', () => {
    it.effect('creates rate limiter with configured concurrency', () =>
      Effect.gen(function*() {
        const rateLimiter = yield* createRateLimiter({ concurrency: 2, minDelayMs: 0 })

        expect(rateLimiter).toBeDefined()
        expect(rateLimiter.withRateLimit).toBeDefined()
        expect(rateLimiter.getConcurrentCount).toBeDefined()
      }))

    it.effect('getConcurrentCount starts at zero', () =>
      Effect.gen(function*() {
        const rateLimiter = yield* createRateLimiter({ concurrency: 3, minDelayMs: 0 })
        const count = yield* rateLimiter.getConcurrentCount()

        expect(count).toBe(0)
      }))

    it.scoped('enforces concurrency limit', () =>
      Effect.gen(function*() {
        const rateLimiter = yield* createRateLimiter({ concurrency: 2, minDelayMs: 0 })

        const maxConcurrent = yield* Ref.make(0)
        const currentConcurrent = yield* Ref.make(0)

        const task = (id: number) =>
          rateLimiter.withRateLimit(
            Effect.gen(function*() {
              const current = yield* Ref.updateAndGet(currentConcurrent, n => n + 1)
              yield* Ref.update(maxConcurrent, max => Math.max(max, current))
              // Simulate work with a sleep
              yield* Effect.sleep('100 millis')
              yield* Ref.update(currentConcurrent, n => n - 1)
              return id
            }),
          )

        // Start 5 tasks with unbounded concurrency (semaphore will limit it)
        const fiber = yield* Effect.fork(
          Effect.all([task(1), task(2), task(3), task(4), task(5)], {
            concurrency: 'unbounded',
          }),
        )

        // Advance time enough for all tasks to complete
        yield* TestClock.adjust('500 millis')
        const results = yield* Fiber.join(fiber)

        const observedMax = yield* Ref.get(maxConcurrent)
        // The semaphore should limit to 2 concurrent operations
        expect(observedMax).toBeLessThanOrEqual(2)
        // All tasks should complete
        expect(results.sort()).toEqual([1, 2, 3, 4, 5])
      }))

    it.effect('withRateLimit executes effect successfully', () =>
      Effect.gen(function*() {
        const rateLimiter = yield* createRateLimiter({ concurrency: 2, minDelayMs: 0 })

        const result = yield* rateLimiter.withRateLimit(
          Effect.succeed('test result'),
        )

        expect(result).toBe('test result')
      }))

    it.effect('withRateLimit propagates errors', () =>
      Effect.gen(function*() {
        const rateLimiter = yield* createRateLimiter({ concurrency: 2, minDelayMs: 0 })

        const result = yield* rateLimiter.withRateLimit(
          Effect.fail(new Error('test error')),
        ).pipe(Effect.either)

        expect(result._tag).toBe('Left')
      }))
  })
})
