import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
  /** 自定义 fallback（可选），默认渲染内置卡片 */
  fallback?: ReactNode
  /** 当子树捕获到错误时调用（可接日志上报） */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
}

/**
 * 页面级错误边界：捕获子树渲染期间的未处理异常，
 * 展示友好恢复卡片而非白屏崩溃。重试按钮通过重置 state 重新挂载子树。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info)
    // 控制台留痕便于调试
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  private handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex min-h-[50vh] w-full items-center justify-center">
          <div className="mx-4 max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <div className="mb-3 text-3xl">!</div>
            <h2 className="mb-2 text-lg font-semibold text-destructive">页面出错了</h2>
            <p className="mb-1 text-sm text-muted-foreground">
              {this.state.error.message || "未知渲染错误"}
            </p>
            <p className="mb-4 text-xs text-muted-foreground/70">
              如反复出现请刷新页面或反馈管理员
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleRetry}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                重试加载
              </button>
              <a
                href="/"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                返回首页
              </a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
