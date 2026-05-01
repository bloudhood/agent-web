/**
 * Result<T, E> — explicit success/error union, replaces silent try/catch.
 *
 * Usage:
 *   const r = ok(42);
 *   if (r.ok) console.log(r.value); else console.error(r.error);
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = Error> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok === true;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return r.ok === false;
}

export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok === true) return r.value;
  const e = r.error;
  throw e instanceof Error ? e : new Error(String(e));
}

export function map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  if (r.ok === true) return ok(fn(r.value));
  return err(r.error);
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (e: E) => F): Result<T, F> {
  if (r.ok === true) return ok(r.value);
  return err(fn(r.error));
}

export async function tryAsync<T>(
  fn: () => Promise<T>,
): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export function trySync<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export class DomainError extends Error {
  readonly code: string;
  readonly meta?: Record<string, unknown>;

  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.meta = meta;
  }
}
