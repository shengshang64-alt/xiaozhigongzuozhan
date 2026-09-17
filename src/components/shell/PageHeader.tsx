type PageHeaderProps = {
  title: string
  desc?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, desc, actions }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground lg:text-2xl">{title}</h1>
        {desc ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{desc}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
