/**
 * Stream Watchdog
 * 
 * Monitors streaming responses for idle timeouts and provides
 * periodic logging when the stream is waiting.
 */

export interface StreamWatchdogOptions {
  /** Idle timeout in milliseconds. Default: 30000 (30s) */
  idleTimeoutMs?: number;
  /** Log interval when idle. Default: 10000 (10s) */
  logIntervalMs?: number;
  /** Called when idle timeout triggers abort */
  onAbort?: () => void;
}

export class StreamWatchdog {
  private idleTimer: NodeJS.Timeout | null = null;
  private logTimer: NodeJS.Timeout | null = null;
  private _aborted = false;
  private startTime = 0;
  private lastActivity = 0;
  
  private readonly idleTimeoutMs: number;
  private readonly logIntervalMs: number;
  private readonly onAbort?: () => void;
  
  constructor(options: StreamWatchdogOptions = {}) {
    // Allow env override, then option, then default
    const envTimeout = Number(process.env.LETTA_STREAM_IDLE_TIMEOUT_MS);
    this.idleTimeoutMs = Number.isFinite(envTimeout) && envTimeout > 0
      ? envTimeout
      : (options.idleTimeoutMs ?? 120000);
    this.logIntervalMs = options.logIntervalMs ?? 10000;
    this.onAbort = options.onAbort;
  }
  
  /**
   * Start watching the stream
   */
  start(): void {
    this.startTime = Date.now();
    this.lastActivity = this.startTime;
    this._aborted = false;
    
    this.resetIdleTimer();
    
    // Periodic logging when idle
    this.logTimer = setInterval(() => {
      const now = Date.now();
      const idleMs = now - this.lastActivity;
      if (idleMs >= this.logIntervalMs) {
        console.log('[Bot] Stream waiting', {
          elapsedMs: now - this.startTime,
          idleMs,
        });
      }
    }, this.logIntervalMs);
  }
  
  /**
   * Call on each stream chunk to reset the idle timer
   */
  ping(): void {
    this.lastActivity = Date.now();
    this.resetIdleTimer();
  }
  
  /**
   * Stop watching and cleanup all timers
   */
  stop(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = null;
    }
  }
  
  /**
   * Whether the watchdog triggered an abort
   */
  get isAborted(): boolean {
    return this._aborted;
  }
  
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    
    this.idleTimer = setTimeout(() => {
      if (this._aborted) return;
      this._aborted = true;
      
      console.warn(`[Bot] Stream idle timeout after ${this.idleTimeoutMs}ms, aborting...`);
      
      if (this.onAbort) {
        this.onAbort();
      }
    }, this.idleTimeoutMs);
  }
}
