/**
 * The API is always called with a relative URL: the SPA and API share an origin (dev proxy in
 * development, reverse proxy in production). Angular only attaches the X-XSRF-TOKEN header to
 * same-origin requests, and the auth cookies are SameSite=Strict.
 */
export const API_BASE = '/api/v1';

export const api = (path: string) => `${API_BASE}${path}`;
