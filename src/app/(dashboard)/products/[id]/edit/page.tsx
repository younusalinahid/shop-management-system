import { ProductFormPage } from '@/components/products/product-form-page'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProductFormPage id={id} />
}
