export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, options);
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);

export const num = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "—" : value.toFixed(digits);

export const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;

/** Nanosecond decimal strings to UTC seconds (exact enough for chart positions). */
export const seconds = (ns: string) => Number(BigInt(ns) / 1_000_000_000n);

export const utc = (ns: string) => {
  const ms = Number(BigInt(ns) / 1_000_000n);
  return new Date(ms).toISOString().slice(5, 23).replace("T", " ");
};
