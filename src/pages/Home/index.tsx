import { HomePage } from "./HomePage"
import { useHome } from "./useHome"

export default function HomeRoute() {
  const vm = useHome()
  return <HomePage {...vm} />
}
