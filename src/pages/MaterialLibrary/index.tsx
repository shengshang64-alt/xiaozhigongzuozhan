import { MaterialLibraryPage } from "./MaterialLibraryPage"
import { useMaterialLibrary } from "./useMaterialLibrary"

export default function MaterialLibraryRoute() {
  const p = useMaterialLibrary()
  return <MaterialLibraryPage p={p} />
}
