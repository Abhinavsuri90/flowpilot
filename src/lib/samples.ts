// Synthetic sample files served from /public/samples, for trying recipes quickly.

export const SAMPLE_FILES = [
  { name: 'sales_A.csv', columns: ['order_id', 'region', 'sales_rep', 'status', 'amount'] },
  { name: 'sales_B.csv', columns: ['order_id', 'region', 'sales_rep', 'status', 'amount'] },
  { name: 'marketing_spend.csv', columns: ['campaign', 'channel', 'status', 'spend'] },
  { name: 'orders_dated.csv', columns: ['order_id', 'ordered_on', 'region', 'sales_rep', 'status', 'amount'] },
] as const

export type SampleName = (typeof SAMPLE_FILES)[number]['name']

/** Samples that contain every column a recipe requires. */
export function compatibleSamples(required: string[]) {
  return SAMPLE_FILES.filter((s) => required.every((c) => (s.columns as readonly string[]).includes(c)))
}

export async function fetchSample(name: SampleName): Promise<File> {
  const res = await fetch(`/samples/${name}`)
  if (!res.ok) throw new Error(`Could not load ${name}`)
  return new File([await res.text()], name, { type: 'text/csv' })
}
