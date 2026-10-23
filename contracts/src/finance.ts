import type { PersonCard } from './members.js';

/**
 * Family funds: dues, contributions towards a ceremony (a funeral, a wedding), projects and welfare.
 * Amounts are whole numbers in the currency's minor unit (pesewas for GHS, cents for USD), so totals add
 * up exactly.
 */
export const FUND_KINDS = ['dues', 'ceremony', 'project', 'welfare', 'other'] as const;
export type FundKind = (typeof FUND_KINDS)[number];
export const FUND_KIND_LABELS: Record<FundKind, string> = {
  dues: 'Family dues',
  ceremony: 'Ceremony',
  project: 'Project',
  welfare: 'Welfare',
  other: 'Other',
};

/**
 * Who sees a fund: `admins` — administrators and treasurers only; `totals` — members see the fund and its
 * totals; `members` — members also see who gave what. Everyone always sees their own contributions.
 */
export const FUND_VISIBILITIES = ['admins', 'totals', 'members'] as const;
export type FundVisibility = (typeof FUND_VISIBILITIES)[number];

export const DUES_PERIODS = ['monthly', 'yearly', 'once'] as const;
export type DuesPeriod = (typeof DUES_PERIODS)[number];

export const PAYMENT_METHODS = ['cash', 'mobile_money', 'bank', 'cheque', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
  bank: 'Bank transfer',
  cheque: 'Cheque',
  other: 'Other',
};

/** Currencies offered first; any ISO 4217 code is accepted. */
export const COMMON_CURRENCIES = ['GHS', 'NGN', 'XOF', 'KES', 'ZAR', 'GBP', 'USD', 'EUR', 'CAD'] as const;
export const MAX_AMOUNT = 1_000_000_000_000;

export interface FundView {
  id: string;
  name: string;
  purpose: string;
  kind: FundKind;
  currency: string;
  /** Amount hoped for, if any. */
  target: number | null;
  dues: { amount: number; period: DuesPeriod } | null;
  /** People expected to pay dues. */
  payers: PersonCard[];
  status: 'open' | 'closed';
  visibility: FundVisibility;
  ceremony: { id: string; title: string } | null;
  totals: { amount: number; count: number; contributors: number };
  createdAt: string;
  viewerCan: { manage: boolean; seeContributions: boolean };
  version: number;
}

export interface FundInput {
  name: string;
  purpose?: string;
  kind: FundKind;
  currency?: string;
  target?: number | null;
  dues?: { amount: number; period: DuesPeriod } | null;
  payerIds?: string[];
  visibility?: FundVisibility;
  status?: 'open' | 'closed';
  ceremonyId?: string | null;
}
export type UpdateFundRequest = Partial<FundInput> & { version: number };

export interface FundContributionView {
  id: string;
  fundId: string;
  person: PersonCard | null;
  /** For contributors who are not in the tree (friends, church, colleagues). */
  contributorName: string;
  amount: number;
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  recordedBy: string | null;
  createdAt: string;
}

export interface FundContributionInput {
  memberId?: string | null;
  contributorName?: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  reference?: string;
  note?: string;
}

export interface FundReport {
  /** Totals per family branch. A person in two branches counts in both, so these can add up to more than the fund. */
  byBranch: { branch: { id: string; name: string } | null; amount: number; count: number }[];
  byMonth: { month: string; amount: number }[];
  /** For dues: what each expected payer owes and has paid for the chosen period. */
  dues: { period: string; rows: { person: PersonCard; due: number; paid: number; balance: number }[]; totals: { due: number; paid: number } } | null;
}

/** "GH₵ 1,250.00" — amounts are in minor units. */
export function formatMoney(amount: number, currency: string, locale = 'en-GB'): string {
  try {
    const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 10 ** digits);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

/** Decimal places of a currency's minor unit (2 for GHS, 0 for XOF). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}
