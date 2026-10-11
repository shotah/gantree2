/**
 * Failures from the chat client. The agent loop branches on `kind`:
 * `empty` is the old `ErrEmptyContent`, `aborted` is a caller cancel,
 * and rate limit / context length / auth carry a stable message prefix.
 */

export type ProviderErrorKind
  = | "empty"
    | "rate_limit"
    | "context_length"
    | "auth"
    | "timeout"
    | "aborted"
    | "request"
    | "http";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(kind: ProviderErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.kind = kind;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
  }
}

/** `errors.Is(err, ErrEmptyContent)` from the Go client. */
export function isEmptyContent(err: unknown): boolean {
  return err instanceof ProviderError && err.kind === "empty";
}
