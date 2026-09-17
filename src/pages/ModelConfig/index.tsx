import { ModelConfigPage } from "./ModelConfigPage"
import { useModelConfig } from "./useModelConfig"

export default function ModelConfigRoute() {
  const vm = useModelConfig()
  return <ModelConfigPage {...vm} />
}
