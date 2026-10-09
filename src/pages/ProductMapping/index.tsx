import { ProductMappingPage } from "./ProductMappingPage"
import { useProductMapping } from "./useProductMapping"

export default function ProductMappingRoute() {
  const vm = useProductMapping()
  return <ProductMappingPage {...vm} />
}
