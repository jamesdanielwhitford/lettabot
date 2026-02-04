import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StreamWatchdog } from './stream-watchdog.js';

describe('StreamWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear env var before each test
    delete process.env.LETTA_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('default behavior', () => {
    it('uses 120s default idle timeout', () => {
      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort });
      watchdog.start();

      // Should not abort before 120s
      vi.advanceTimersByTime(119000);
      expect(onAbort).not.toHaveBeenCalled();
      expect(watchdog.isAborted).toBe(false);

      // Should abort at 120s
      vi.advanceTimersByTime(1000);
      expect(onAbort).toHaveBeenCalledTimes(1);
      expect(watchdog.isAborted).toBe(true);

      watchdog.stop();
    });

    it('ping() resets the idle timer', () => {
      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort });
      watchdog.start();

      // Advance 100s, then ping
      vi.advanceTimersByTime(100000);
      watchdog.ping();

      // Advance another 100s - should not abort (only 100s since ping)
      vi.advanceTimersByTime(100000);
      expect(onAbort).not.toHaveBeenCalled();

      // Advance 20 more seconds - now 120s since last ping
      vi.advanceTimersByTime(20000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      watchdog.stop();
    });

    it('stop() prevents abort callback', () => {
      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort });
      watchdog.start();

      vi.advanceTimersByTime(25000);
      watchdog.stop();

      // Even after full timeout, should not call abort
      vi.advanceTimersByTime(10000);
      expect(onAbort).not.toHaveBeenCalled();
    });
  });

  describe('custom options', () => {
    it('respects custom idleTimeoutMs', () => {
      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort, idleTimeoutMs: 5000 });
      watchdog.start();

      vi.advanceTimersByTime(4000);
      expect(onAbort).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      watchdog.stop();
    });
  });

  describe('environment variable override', () => {
    it('uses LETTA_STREAM_IDLE_TIMEOUT_MS when set', () => {
      process.env.LETTA_STREAM_IDLE_TIMEOUT_MS = '10000';

      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort });
      watchdog.start();

      vi.advanceTimersByTime(9000);
      expect(onAbort).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      watchdog.stop();
    });

    it('env var takes precedence over options', () => {
      process.env.LETTA_STREAM_IDLE_TIMEOUT_MS = '5000';

      const onAbort = vi.fn();
      // Option says 60s, but env says 5s
      const watchdog = new StreamWatchdog({ onAbort, idleTimeoutMs: 60000 });
      watchdog.start();

      vi.advanceTimersByTime(5000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      watchdog.stop();
    });

    it('ignores invalid env var values', () => {
      process.env.LETTA_STREAM_IDLE_TIMEOUT_MS = 'invalid';

      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort, idleTimeoutMs: 5000 });
      watchdog.start();

      // Should use option value (5s) since env is invalid
      vi.advanceTimersByTime(5000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      watchdog.stop();
    });

    it('ignores zero env var value', () => {
      process.env.LETTA_STREAM_IDLE_TIMEOUT_MS = '0';

      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort, idleTimeoutMs: 5000 });
      watchdog.start();

      // Should use option value (5s) since env is 0
      vi.advanceTimersByTime(5000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      watchdog.stop();
    });
  });

  describe('logging', () => {
    it('logs waiting message at logIntervalMs when idle', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const watchdog = new StreamWatchdog({ logIntervalMs: 1000 });
      watchdog.start();

      // First interval - 1s idle
      vi.advanceTimersByTime(1000);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Bot] Stream waiting',
        expect.objectContaining({ idleMs: expect.any(Number) })
      );

      consoleSpy.mockRestore();
      watchdog.stop();
    });
  });

  describe('edge cases', () => {
    it('can be stopped before start', () => {
      const watchdog = new StreamWatchdog({});
      expect(() => watchdog.stop()).not.toThrow();
    });

    it('multiple pings work correctly', () => {
      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort, idleTimeoutMs: 1000 });
      watchdog.start();

      // Rapid pings should keep resetting
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(500);
        watchdog.ping();
      }

      expect(onAbort).not.toHaveBeenCalled();

      // Now let it timeout
      vi.advanceTimersByTime(1000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      watchdog.stop();
    });

    it('abort callback only fires once', () => {
      const onAbort = vi.fn();
      const watchdog = new StreamWatchdog({ onAbort, idleTimeoutMs: 1000 });
      watchdog.start();

      vi.advanceTimersByTime(1000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      // Even if we wait more, should not fire again
      vi.advanceTimersByTime(5000);
      expect(onAbort).toHaveBeenCalledTimes(1);

      watchdog.stop();
    });
  });
});
