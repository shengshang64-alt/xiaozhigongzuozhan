// 路由唯一真源（route registry）
//
// 为什么要有这个文件：路由元数据原本散在四处且互相漂移——
//   App.tsx 的 17 段 lazy 路由 / lib/routePreload.ts 的 LOADERS /
//   SidebarNav 的 NAV_SECTIONS label / TopBarShell.ROUTE_TITLES + WorkbenchShell.routeLabels
// 同一路径出现「标书工作」与「标书工作台」两种文案。标签栏要显示标签名，必须有
// 唯一口径，故收敛到本文件：路径、文案、图标、分组、懒加载器、预加载全部一处定义。
//
// 约束：
//  - loader 一律用动态 import()：保持路由级 code splitting，并让
//    onDemandHeavyLibs.test.ts（docx/xlsx/pptxgenjs 静态不可达）继续通过。
//  - 新增页面只改这里 + 在 NAV_GROUPS 里挂分组；不要再去别处加映射。

import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import {
  ArrowLeftRight,
  BookOpen,
  Bot,
  Building2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Flame,
  Images,
  LayoutGrid,
  Monitor,
  Search,
  Settings,
  ShieldCheck,
  Type,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react"

export type RouteMeta = {
  /** 顶层路径（本应用全部路由都是扁平顶层路径，无参数路由） */
  path: string
  /** 侧栏 / 标签栏 / 面包屑 / 文档标题统一文案 */
  label: string
  icon: LucideIcon
  /** 懒加载组件（与 loader 同源，避免 App.tsx 再维护一份 import 列表） */
  Component: LazyExoticComponent<ComponentType>
  /** 动态 import 入口（预加载用） */
  loader: () => Promise<{ default: ComponentType }>
  /** 仅本地域管理员可见：只控侧栏入口显隐，不拦路由（保持 R-201 阶段A 现状） */
  adminOnly?: boolean
}

type RouteDef = Omit<RouteMeta, "Component">

const def = (
  path: string,
  label: string,
  icon: LucideIcon,
  loader: () => Promise<{ default: ComponentType }>,
  adminOnly?: boolean,
): RouteDef => (adminOnly ? { path, label, icon, loader, adminOnly } : { path, label, icon, loader })

/**
 * 全部业务路由。顺序 = 侧栏分组顺序（见 NAV_GROUPS），也是标签栏默认顺序。
 * loader 路径与 pages 下各页面的 index.tsx 一一对应（它们都是默认导出的薄壳）。
 */
const ROUTE_DEFS: RouteDef[] = [
  def("/", "工作台总览", LayoutGrid, () => import("@/pages/Home/index.tsx")),
  def("/intel-center", "情报中心", Search, () => import("@/pages/IntelCenter/index.tsx")),
  def("/ai-hot", "AI 动态", Flame, () => import("@/pages/AiHot/index.tsx")),
  def("/customer-management", "客户管理", Users, () => import("@/pages/CustomerManagement/index.tsx")),
  def("/solution-studio", "方案工作室", FileText, () => import("@/pages/SolutionStudio/index.tsx")),
  def("/product-mapping", "产品映射", ArrowLeftRight, () => import("@/pages/ProductMapping/index.tsx")),
  def("/ppt-quote", "PPT 与报价", Monitor, () => import("@/pages/PptQuote/index.tsx")),
  def("/materials", "素材库", Images, () => import("@/pages/MaterialLibrary/index.tsx")),
  def("/bid-workspace", "标书工作台", FileCheck2, () => import("@/pages/BidWorkspace/index.tsx")),
  def("/bid-check", "标书检查", ClipboardCheck, () => import("@/pages/BidCheck/index.tsx")),
  def("/format-tool", "格式刷新", Type, () => import("@/pages/FormatTool/index.tsx")),
  def("/knowledge", "知识库", BookOpen, () => import("@/pages/Knowledge/index.tsx")),
  def("/qual-certs", "资质台账", ShieldCheck, () => import("@/pages/QualCerts/index.tsx")),
  def("/competitors", "竞品分析", Building2, () => import("@/pages/Competitors/index.tsx")),
  def("/assistant", "小智助手", Bot, () => import("@/pages/Assistant/index.tsx")),
  def("/model-config", "模型配置", Settings, () => import("@/pages/ModelConfig/index.tsx")),
  def("/team", "团队管理", UserCog, () => import("@/pages/Team/index.tsx"), true),
]

export const ROUTES: RouteMeta[] = ROUTE_DEFS.map((d) => ({ ...d, Component: lazy(d.loader) }))

export const ROUTE_BY_PATH: Record<string, RouteMeta> = ROUTES.reduce<Record<string, RouteMeta>>(
  (acc, r) => {
    acc[r.path] = r
    return acc
  },
  {},
)

/** 首页路径：关闭全部标签后的保底页 */
export const HOME_PATH = "/"

/** 路径是否存在对应页面（未注册路径由外壳渲染 NotFound） */
export function hasRoute(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROUTE_BY_PATH, path)
}

/** 面包屑/文档标题/标签文案（未注册路径回落到「工作台」，与改造前一致） */
export function labelFor(path: string): string {
  return ROUTE_BY_PATH[path]?.label ?? "工作台"
}

/**
 * 侧栏分组（与 docs/redesign 对齐）。
 * 只放路径，label/icon/adminOnly 一律从 ROUTES 取，杜绝两处文案漂移。
 */
export const NAV_GROUPS: { title: string; paths: string[] }[] = [
  // 业务分组替代早期版本的军事化分组词（术语规范见 docs/术语规范表.md），
  // 用一线售前能听懂的动词短语：哪里看线索、哪里写材料、哪里沉淀资产。
  // AI 动态（模型调用记录/用量）属于"沉淀·团队"——元功能，不放"客户·线索"。
  { title: "客户 · 线索", paths: ["/", "/customer-management", "/intel-center"] },
  { title: "方案 · 标书 · 汇报", paths: ["/solution-studio", "/product-mapping", "/ppt-quote", "/materials", "/bid-workspace", "/bid-check", "/format-tool"] },
  { title: "沉淀 · 团队", paths: ["/knowledge", "/qual-certs", "/competitors", "/assistant", "/model-config", "/ai-hot", "/team"] },
]

// ---------------------------------------------------------------------------
// 预加载（原 lib/routePreload.ts 迁入：LOADERS 与路由表同源后不必再维护第二份）
// ---------------------------------------------------------------------------

/** 已在飞行中/已完成的 path 集合（防重复触发） */
const preloaded = new Set<string>()

/** 预加载指定路由的 lazy chunk（幂等、静默失败；React.lazy 内部复用同一 module promise） */
export function preloadRoute(path: string): void {
  const meta = ROUTE_BY_PATH[path]
  if (!meta || preloaded.has(path)) return
  preloaded.add(path)
  // 失败不标记（下次 hover 可重试）
  meta.loader().catch(() => preloaded.delete(path))
}
