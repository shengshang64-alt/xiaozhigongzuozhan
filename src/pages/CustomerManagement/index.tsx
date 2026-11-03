import { CustomerManagementPage } from "./CustomerManagementPage"
import { useCustomerManagement } from "./useCustomerManagement"

export default function CustomerManagementRoute() {
  const vm = useCustomerManagement()
  return <CustomerManagementPage {...vm} />
}
