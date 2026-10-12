/** A ledger failure the tool layer shows the model as text. */
export class AimsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AimsError";
  }
}
