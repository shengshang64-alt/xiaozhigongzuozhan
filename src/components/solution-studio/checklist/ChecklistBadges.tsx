import { MATCH_KIND_LABEL, targetLabel, type MatchRow } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// 建设清单共用徽标
// ---------------------------------------------------------------------------

export function RatingHitsBadges({ hits }: { hits: string[] }) {
  if (!hits?.length) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {hits.map((code) => (
        <span key={code} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {targetLabel(code)}
        </span>
      ))}
    </span>
  )
}

export function SourceBadge({ source }: { source: "company" | "external" }) {
  return source === "external" ? (
    <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
      外购
    </span>
  ) : (
    <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
      我公司
    </span>
  )
}

export function MatchKindBadge({ kind }: { kind: MatchRow["kind"] }) {
  const tone =
    kind === "none"
      ? "border border-border bg-muted text-muted-foreground"
      : kind === "manual"
        ? "border border-border bg-secondary text-secondary-foreground"
        : "border border-primary/40 bg-primary/10 text-primary"
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{MATCH_KIND_LABEL[kind]}</span>
}
