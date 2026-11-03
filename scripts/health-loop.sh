#!/usr/bin/env bash
# 全站健康体检脚本（循环测试优化流程·每循环第一步）
# 用法：bash /workspace/app/scripts/health-loop.sh
# 输出：stdout 摘要 + logs/health_<timestamp>.log；退出码 0=全绿 1=有红项
set -u
TS=$(date +%Y%m%d_%H%M%S)
LOG_DIR=/workspace/app/logs
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/health_$TS.log"
RED=0

say() { echo "$@" | tee -a "$LOG"; }
ok()  { say "  ✅ $*"; }
bad() { say "  ❌ $*"; RED=1; }

say "===== 全站健康体检 $TS ====="

# 1 服务进程
say "[1] 服务进程"
for svc in app-dev-server pocketbase-bin; do
  st=$(supervisorctl -c /workspace/supervisord.conf status "$svc" 2>/dev/null | awk '{print $2}')
  [ "$st" = "RUNNING" ] && ok "$svc RUNNING" || bad "$svc 状态=$st"
done

# 2 端口健康
say "[2] 端口健康"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8000/ || echo 000)
[ "$code" = "200" ] && ok "vite :8000 -> $code" || bad "vite :8000 -> $code"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:7000/api/health || echo 000)
[ "$code" = "200" ] && ok "pocketbase :7000 health -> $code" || bad "pocketbase :7000 health -> $code"

# 3 业务路由 smoke（GET list，带测试用户头；401/200 均视为路由存活，5xx/404 为红）
say "[3] 业务路由 smoke"
UID_TEST="user_healthloop"
for path in "/api/customers" "/api/opportunities" "/api/intel/sources" "/api/bid_projects" "/api/solutions" "/api/quotes" "/api/ppt_decks" "/api/kb_docs" "/api/kb_qa_pairs" "/api/todos" "/api/intel_prefs" "/api/model-gw/configs"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "X-Rh-User-Id: $UID_TEST" "http://127.0.0.1:7000$path" || echo 000)
  case "$code" in
    200|401|400) ok "$path -> $code" ;;
    *) bad "$path -> $code" ;;
  esac
done

# 4 情报智能路由
say "[4] 情报自定义路由"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "X-Rh-User-Id: $UID_TEST" "http://127.0.0.1:7000/api/intel/items?perPage=1" || echo 000)
case "$code" in 200|401) ok "/api/intel/items -> $code" ;; *) bad "/api/intel/items -> $code" ;; esac
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "X-Rh-User-Id: $UID_TEST" "http://127.0.0.1:7000/api/intel/prefs" || echo 000)
case "$code" in 200|401) ok "/api/intel/prefs -> $code" ;; *) bad "/api/intel/prefs -> $code" ;; esac

# 5 前端页面路由（vite SPA 全 200，抽 4 个）
say "[5] 前端页面路由"
for p in "/" "/bid-workspace" "/intel-center" "/customer-management"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:8000$p" || echo 000)
  [ "$code" = "200" ] && ok "page $p -> $code" || bad "page $p -> $code"
done

# 6 磁盘与日志卫生
say "[6] 卫生检查"
du=$(du -sm /workspace/pocketbase-bin/pb_data 2>/dev/null | awk '{print $1}')
say "  ℹ️ pb_data 大小 ${du}MB"
nlogs=$(ls -1 "$LOG_DIR" 2>/dev/null | wc -l)
say "  ℹ️ logs 目录文件数 $nlogs"

say "===== 体检结束 red=$RED ====="
exit $RED
