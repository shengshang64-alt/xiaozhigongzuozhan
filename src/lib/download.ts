/**
 * R110 全站文件下载唯一入口：Blob → 临时 <a> → 点击 → 清理。
 *
 * 此前全站 9 处调用点各写一份 createObjectURL/click/revoke，且漂移出 4 种口径
 * （点击后立即 revoke / 3000ms / 4000ms / 不挂 DOM 直接 click）。本函数统一取
 * 最稳健组合：挂到 body 再点（部分浏览器内核对未插入文档的元素忽略 click），
 * 点击后延时 3s 释放（部分慢内核/旧引擎对点击后立即 revoke 会打断刚触发的下载）。
 * 对用户无行为差异：下载内容与文件名一概不变，仅内存释放统一延后 3 秒。
 */
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
