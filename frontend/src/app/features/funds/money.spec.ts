import { describe, expect, it } from 'vitest';
import { formatMoney } from '@fh/contracts';
import { moneyInput, parseMoney } from './money';

describe('money', () => {
  it('turns typed amounts into minor units exactly', () => {
    expect(parseMoney('50', 'GHS')).toBe(5000);
    expect(parseMoney('1,250.5', 'GHS')).toBe(125050);
    expect(parseMoney('0.1', 'GHS')).toBe(10);
    expect(parseMoney('2500', 'XOF')).toBe(2500);
    expect(parseMoney('1.234', 'GHS')).toBeNull();
    expect(parseMoney('2.5', 'XOF')).toBeNull();
    expect(parseMoney('-5', 'GHS')).toBeNull();
    expect(parseMoney('0', 'GHS')).toBeNull();
    expect(parseMoney('abc', 'GHS')).toBeNull();
  });

  it('shows amounts back in the currency', () => {
    expect(moneyInput(125050, 'GHS')).toBe('1250.50');
    expect(moneyInput(2500, 'XOF')).toBe('2500');
    expect(formatMoney(125050, 'GHS')).toMatch(/1,250\.50/);
    expect(formatMoney(2500, 'XOF')).toMatch(/2,500/);
  });
});
