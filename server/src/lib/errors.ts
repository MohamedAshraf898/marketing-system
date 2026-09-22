import { ZodError } from 'zod';

/**
 * Every error the API returns has a stable machine `code`. The web app translates the
 * code into the user's language, so `message` is only a readable English fallback.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'),
  invalidCredentials: () => new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.'),
  accountDisabled: () => new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.'),
  forbidden: () => new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.'),
  /** Also used for records outside the caller's scope so their existence is never revealed. */
  notFound: () => new ApiError(404, 'NOT_FOUND', 'The requested item was not found.'),
  conflict: (code = 'CONFLICT', message = 'This conflicts with existing data.') => new ApiError(409, code, message),
  badRequest: (code: string, message: string, fields?: Record<string, string>) => new ApiError(400, code, message, fields),
  validation: (fields: Record<string, string>) =>
    new ApiError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', fields),
};

/** Turns zod issues into { field: 'required' | 'invalid_email' | ... } codes the UI can translate. */
export function zodToFields(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (out[key]) continue;
    let code = 'invalid';
    switch (issue.code) {
      case 'invalid_type':
        code = issue.received === 'undefined' || issue.received === 'null' ? 'required' : 'invalid';
        break;
      case 'too_small':
        code = issue.type === 'string' && issue.minimum === 1 ? 'required' : issue.type === 'string' ? 'too_short' : 'too_small';
        break;
      case 'too_big':
        code = issue.type === 'string' ? 'too_long' : 'too_big';
        break;
      case 'invalid_string':
        code = issue.validation === 'email' ? 'invalid_email' : issue.validation === 'url' ? 'invalid_url' : 'invalid';
        break;
      case 'invalid_enum_value':
        code = 'invalid_choice';
        break;
      case 'unrecognized_keys':
        code = 'not_allowed';
        break;
      case 'custom':
        code = issue.message || 'invalid';
        break;
    }
    out[key] = code;
  }
  return out;
}
