/**
 * Errors the service layer throws on purpose. Each one carries the HTTP status
 * it maps to and a message that is safe to show to a person (in Bulgarian,
 * because that is the language of the UI). Anything that is not an AppError
 * is a bug and becomes a generic 500.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Влез в профила си, за да продължиш.') {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Нямаш права за това действие.') {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}
