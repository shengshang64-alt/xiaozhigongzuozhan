import { AssistantPage } from "./AssistantPage"
import { useAssistant } from "./useAssistant"

export default function AssistantRoute() {
  const vm = useAssistant()
  return <AssistantPage {...vm} />
}
