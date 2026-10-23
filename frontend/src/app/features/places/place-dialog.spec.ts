import { describe, expect, it } from 'vitest';
import { parseCoordinates } from './place-dialog.component';

describe('parseCoordinates', () => {
  it('reads latitude and longitude as map apps copy them', () => {
    expect(parseCoordinates('6.6885, -1.6244')).toEqual([6.6885, -1.6244]);
    expect(parseCoordinates(' 5.6037 -0.187 ')).toEqual([5.6037, -0.187]);
    expect(parseCoordinates('5;0')).toEqual([5, 0]);
  });

  it('refuses anything else', () => {
    expect(parseCoordinates('Kumasi')).toBeNull();
    expect(parseCoordinates('6.6885')).toBeNull();
    expect(parseCoordinates('96, 10')).toBeNull();
    expect(parseCoordinates('6, 190')).toBeNull();
  });
});
