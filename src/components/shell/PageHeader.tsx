type PageHeaderProps = {
  title: string
  /** 一句话说清这屏解决什么问题；允许 <b> 强调关键词（原型 .ph .desc b 的行内加粗语义） */
  desc?: React.ReactNode
  /** 标题右侧徽标（如健康看板「暂无统计」灰徽标）。有真数据才放数字，别拿演示值充数 */
  titleExtra?: React.ReactNode
  /** 标题下的关键值行（统计区间 / 采样 / 数据更新）。**只放有真源的值**，无真源写「—」 */
  meta?: React.ReactNode
  actions?: React.ReactNode
}

export function PageHeader({ title, desc, titleExtra, meta, actions }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-foreground lg:text-2xl">
          {title}
          {titleExtra}
        </h1>
        {desc ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{desc}</p> : null}
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{meta}</div>
        ) : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
