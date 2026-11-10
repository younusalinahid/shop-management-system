import { ReturnFormPage } from '@/components/returns/return-form-page'

export default async function Page({ searchParams }: { searchParams: Promise<{ sale?: string }> }) {
  const { sale } = await searchParams
  return <ReturnFormPage key={sale ?? 'lookup'} kind="sale" docId={sale} />
}
