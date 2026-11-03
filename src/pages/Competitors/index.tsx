import { CompetitorsPage } from "./CompetitorsPage"
import { useCompetitors } from "./useCompetitors"

export default function CompetitorsRoute() {
  const vm = useCompetitors()
  return <CompetitorsPage {...vm} />
}
