import { FormatToolPage } from "./FormatToolPage"
import { useFormatTool } from "./useFormatTool"

export default function FormatToolRoute() {
  const vm = useFormatTool()
  return <FormatToolPage {...vm} />
}
