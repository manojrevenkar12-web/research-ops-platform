const eur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dayShort = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const time = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export const formatEur = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "" : eur.format(Number(v));
export const formatNumber = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "" : num.format(Number(v));
export const formatDay = (iso: string) => day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const formatDayShort = (iso: string) => dayShort.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const formatTime = (iso: string) => `${time.format(new Date(iso))} UTC`;

/** Monday of the week containing `iso`, as YYYY-MM-DD. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const today = () => new Date().toISOString().slice(0, 10);

export function previousMonth(iso = today()): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
