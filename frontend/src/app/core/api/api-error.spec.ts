import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from './api-error';

describe('ApiError', () => {
  it('reads the server error envelope including field details', () => {
    const err = ApiError.from(
      new HttpErrorResponse({
        status: 400,
        error: { error: { code: 'VALIDATION_FAILED', message: 'Bad', details: [{ path: 'email', message: 'Invalid' }], requestId: 'r1' } },
      }),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fieldError('email')).toBe('Invalid');
    expect(err.fieldError('password')).toBeUndefined();
    expect(err.requestId).toBe('r1');
  });

  it('describes network failures and unknown errors without leaking internals', () => {
    expect(ApiError.from(new HttpErrorResponse({ status: 0 })).code).toBe('NETWORK');
    expect(ApiError.from(new HttpErrorResponse({ status: 502, error: '<html>' })).code).toBe('INTERNAL');
    expect(ApiError.from(new Error('boom')).message).not.toContain('boom');
  });
});
