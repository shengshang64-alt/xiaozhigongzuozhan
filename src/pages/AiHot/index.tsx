import { AiHotPage } from "./AiHotPage"
import { useAiHot } from "./useAiHot"

export default function AiHotRoute() {
  const vm = useAiHot()
  return <AiHotPage {...vm} />
}
