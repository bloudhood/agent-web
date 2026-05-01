/**
 * Structured logger with severity levels, optional sink, and context binding.
 *
 * Wraps the existing lib/logger.js. The legacy module exposes plog(level, event, meta).
 * This module adds:
 *   - level filter (default: INFO)
 *   - context binding (e.g. logger.with({ sessionId }))
 *   - typed levels
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

export type LogSink = (level: LogLevel, event: string, meta?: Record<string, unknown>) => void;

export interface Logger {
  debug(event: string, meta?: Record<string, unknown>): void;
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
  log(level: LogLevel, event: string, meta?: Record<string, unknown>): void;
  with(context: Record<string, unknown>): Logger;
}

export interface CreateLoggerOptions {
  sink: LogSink;
  level?: LogLevel;
  context?: Record<string, unknown>;
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const { sink, level = 'INFO', context = {} } = opts;
  const minLevel = LEVEL_ORDER[level];

  const log = (l: LogLevel, event: string, meta?: Record<string, unknown>) => {
    if (LEVEL_ORDER[l] < minLevel) return;
    sink(l, event, { ...context, ...(meta || {}) });
  };

  return {
    debug: (e, m) => log('DEBUG', e, m),
    info: (e, m) => log('INFO', e, m),
    warn: (e, m) => log('WARN', e, m),
    error: (e, m) => log('ERROR', e, m),
    log,
    with(extra) {
      return createLogger({ sink, level, context: { ...context, ...extra } });
    },
  };
}

/**
 * Bridge for the legacy plog(level, event, meta) function so old code
 * keeps working while new code prefers the typed Logger.
 */
export function fromPlog(plog: (level: string, event: string, meta?: Record<string, unknown>) => void): Logger {
  return createLogger({
    sink: (level, event, meta) => plog(level, event, meta),
  });
}
