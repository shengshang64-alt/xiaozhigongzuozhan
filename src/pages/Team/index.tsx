import { TeamPage } from "./TeamPage"
import { useTeam } from "./useTeam"

export default function TeamRoute() {
  const vm = useTeam()
  return <TeamPage {...vm} />
}
