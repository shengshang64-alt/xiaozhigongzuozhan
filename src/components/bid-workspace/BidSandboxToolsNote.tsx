import { Link } from "react-router-dom"

/** ⑥ / ⑦ 步脚注：标书检查、格式刷新是不绑定当前项目的沙箱。 */
export function BidSandboxToolsNote() {
  return (
    <p className="mt-4 rounded-md border border-dashed border-border bg-secondary/30 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
      要临时检查或重排一份不在当前项目里的文件，用
      <Link to="/bid-check" className="mx-1 font-medium text-primary hover:underline">
        标书检查
      </Link>
      或
      <Link to="/format-tool" className="mx-1 font-medium text-primary hover:underline">
        格式刷新
      </Link>
      。这两项不绑定当前项目，完整报告只留在本次会话。
    </p>
  )
}
