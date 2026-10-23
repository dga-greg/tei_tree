import { currencyDigits } from '@fh/contracts';

/** "1,250.50" in the currency's units → 125050 minor units; null when it is not an amount. */
export function parseMoney(text: string, currency: string): number | null {
  const clean = text.replace(/[\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const digits = currencyDigits(currency);
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || 0);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** Minor units → "1250.50", for editing. */
export function moneyInput(amount: number | null | undefined, currency: string): string {
  if (!amount) return '';
  const digits = currencyDigits(currency);
  return (amount / 10 ** digits).toFixed(digits);
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
