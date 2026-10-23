import { safeReturnUrl } from './guards';

describe('safeReturnUrl', () => {
  it('keeps in-app paths', () => {
    expect(safeReturnUrl('/settings')).toBe('/settings');
    expect(safeReturnUrl('/admin?page=2')).toBe('/admin?page=2');
  });

  it('rejects external and protocol-relative URLs (open redirect)', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeReturnUrl(bad)).toBe('/');
    }
  });

  it('does not send a signed-in user back to an auth page', () => {
    expect(safeReturnUrl('/auth/login')).toBe('/');
  });
});
