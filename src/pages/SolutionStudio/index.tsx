import { SolutionStudioPage } from "./SolutionStudioPage"
import { useSolutionStudio } from "./useSolutionStudio"

export default function SolutionStudioRoute() {
  const vm = useSolutionStudio()
  return <SolutionStudioPage {...vm} />
}
