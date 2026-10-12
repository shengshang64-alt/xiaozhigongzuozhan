import { BidCheckPage } from "./BidCheckPage"
import { useBidCheck } from "./useBidCheck"

export default function BidCheckRoute() {
  const vm = useBidCheck()
  return <BidCheckPage {...vm} />
}
