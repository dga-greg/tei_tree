export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const addMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
