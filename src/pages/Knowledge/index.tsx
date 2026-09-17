import { KnowledgePage } from "./KnowledgePage"
import { useKnowledge } from "./useKnowledge"

export default function KnowledgeRoute() {
  const vm = useKnowledge()
  return <KnowledgePage {...vm} />
}
