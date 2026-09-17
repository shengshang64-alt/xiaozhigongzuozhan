import { IntelCenterPage } from "./IntelCenterPage"
import { useIntelCenter } from "./useIntelCenter"

export default function IntelCenterRoute() {
  const vm = useIntelCenter()
  return <IntelCenterPage {...vm} />
}
