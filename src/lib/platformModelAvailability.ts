/**
 * 「平台内置模型在本机能不能用」的**唯一判定**（纯函数，零 React / 零网络）。
 *
 * 背景（R3 · D4 模型配置项：「平台内置 gpt-5.5 等本地不可用通道标明不可用，
 * 不得当默认成功路径」）：
 *
 *   平台内置模型经 RunningHub 中转（pb_hooks/llm.pb.js → llm.runninghub.cn），令牌只来自
 *   请求头 `x-rh-api-key` 或环境变量 `RH_LLM_API_KEY`。本地/内网部署（localhost、127.0.0.1、
 *   私有段 IP）既读不到 `Rh-Accesstoken`（该 cookie 属 runninghub.cn 域），项目里也没有
 *   `/sso-popup-callback` 回跳路由，**令牌恒为空** → 接口必然 412 `rh_login_required`。
 *
 *   阶段 1 已经在**模型下拉**里置灰了它（ModelSelect.tsx 的 platformDisabled），
 *   但模型配置页的「公共模型」卡片仍然写着「无需配置密钥，登录 RunningHub 账户后即可使用」，
 *   「设为默认」按钮**可点**——于是它仍然是「看起来可用的默认成功路径」。
 *   实测后果：用户把平台内置设为默认，之后每次生成都 412，而页面上的默认横幅还写着它可用。
 *
 *   本模块把判定收成一处，供模型配置页（卡片标注 + 禁用默认）与下拉（置灰）共用，
 *   避免两处各判一套、迟早漂移。
 */

/** 本机/内网部署域（与 rhLogin.isLocalDeployHost 同口径，但这里是纯判定、不依赖 window）。 */
export function isLocalOrPrivateHostname(hostname: string | null | undefined): boolean {
  const host = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "")
  if (!host) return false
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true
  const parts = host.split(".").map(Number)
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts
    // 回环 + RFC1918 私有段 + link-local（169.254）—— 这些都不是「能拿到 RunningHub 登录态」的域
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  return false
}

/**
 * 平台内置模型在当前部署下是否「确定不可用」。
 *
 * @param opts.hostname 当前页面主机名（浏览器里传 window.location.hostname）
 * @param opts.hasPersonalModel 是否已有可用的个人模型通道
 *
 * 为什么需要 `hasPersonalModel`：只有个人通道存在时才敢禁用/收口——否则会退化成
 * 「一个模型都没有可选」的死局（用户至少还能拿平台内置试一把、看到真实 412 报错）。
 * 这条边界是从 ModelSelect 的既有口径继承来的，不新造。
 */
export function isPlatformModelLocallyUnusable(opts: {
  hostname: string | null | undefined
  hasPersonalModel: boolean
}): boolean {
  return isLocalOrPrivateHostname(opts.hostname) && opts.hasPersonalModel
}

/** 平台内置模型「为什么不可用」的用户可见解释（界面直接显示，不出现内部字段名）。 */
export const PLATFORM_LOCAL_UNAVAILABLE_REASON =
  "当前是本机/内网部署，这台机器拿不到 RunningHub 登录态，平台内置模型调用必然失败（不是网络问题）。" +
  "它只适合线上域使用；在这里请用下方「个人模型」里已配置的通道。" 
