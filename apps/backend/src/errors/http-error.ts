import type { ErrorResponse } from '@factorymustgrow/shared';

type Issues = NonNullable<ErrorResponse['error']['issues']>;

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    // Per-field problems, in the same shape as validation errors.
    public readonly issues?: Issues,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
