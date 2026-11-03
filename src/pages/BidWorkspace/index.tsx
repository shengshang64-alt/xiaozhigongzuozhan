import { BidWorkspacePage } from "./BidWorkspacePage"
import { useBidWorkspace } from "./useBidWorkspace"

export default function BidWorkspaceRoute() {
  const vm = useBidWorkspace()
  return <BidWorkspacePage {...vm} />
}
