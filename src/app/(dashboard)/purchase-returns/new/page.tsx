import { ReturnFormPage } from '@/components/returns/return-form-page'

export default async function Page({ searchParams }: { searchParams: Promise<{ purchase?: string }> }) {
  const { purchase } = await searchParams
  return <ReturnFormPage key={purchase ?? 'lookup'} kind="purchase" docId={purchase} />
}
