import { Route, Routes } from "react-router-dom"
import { WorkbenchShell } from "@/components/shell/WorkbenchShell"
import { NotFound } from "@/components/common/NotFound"
import HomeRoute from "./pages/Home/index.tsx"
import SolutionStudioRoute from "./pages/SolutionStudio/index.tsx"
import BidWorkspaceRoute from "./pages/BidWorkspace/index.tsx"
import PptQuoteRoute from "./pages/PptQuote/index.tsx"
import ModelConfigRoute from "./pages/ModelConfig/index.tsx"
import IntelCenterRoute from "./pages/IntelCenter/index.tsx"
import CustomerManagementRoute from "./pages/CustomerManagement/index.tsx"
import KnowledgeRoute from "./pages/Knowledge/index.tsx"
import AssistantRoute from "./pages/Assistant/index.tsx"

function App() {
  return (
    <Routes>
      <Route element={<WorkbenchShell />}>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/solution-studio" element={<SolutionStudioRoute />} />
        <Route path="/bid-workspace" element={<BidWorkspaceRoute />} />
        <Route path="/ppt-quote" element={<PptQuoteRoute />} />
        <Route path="/model-config" element={<ModelConfigRoute />} />
        <Route path="/intel-center" element={<IntelCenterRoute />} />
        <Route path="/customer-management" element={<CustomerManagementRoute />} />
        <Route path="/knowledge" element={<KnowledgeRoute />} />
        <Route path="/assistant" element={<AssistantRoute />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default App
