import { PptQuotePage } from "./PptQuotePage"
import { usePptQuote } from "./usePptQuote"

export default function PptQuoteRoute() {
  const vm = usePptQuote()
  return <PptQuotePage {...vm} />
}
