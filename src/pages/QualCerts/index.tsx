import { QualCertsPage } from "./QualCertsPage"
import { useQualCerts } from "./useQualCerts"

export default function QualCertsRoute() {
  const p = useQualCerts()
  return <QualCertsPage p={p} />
}
