# VM 沙盒迁移操作单（2026-10-21）

> 背景：沙盒起不来的根因已定位——
> `C:\Users\Administrator\AppData\Local\Claude-3p\vm_bundles` 与 `claude-code-vm`
> 都是 **JUNCTION**，指向 `D:\Claude-3p-vm\{bundles,codevm}`（建于 2026-10-14 13:01），
> 而应用的安全策略**拒绝打开 junction/符号链接**，于是虚拟机每次启动都失败。
> 本次操作把这两个目录从 D 盘搬回 C 盘真实路径，解除 junction。
>
> 数据量：约 **7.99 GB / 15 个文件**。全程有 3 个检查点，任何一步不对就停，可回退。

---

## 第 0 步 · 先记「迁移前凭据」

在**当前没关应用**之前，先开一个普通 cmd 窗口跑这两条，把输出**复制到记事本存好**：

```
dir "D:\Claude-3p-vm" /s | findstr /c:"个文件" /c:"File(s)"
powershell -NoProfile -Command "Get-ChildItem 'D:\Claude-3p-vm' -Recurse -File | Measure-Object Length -Sum | ForEach-Object { 'TOTAL {0} bytes / {1} files' -f $_.Sum, $_.Count }"
```

记下 **总字节数** 和 **文件数**。后面第 4、6 步要拿它对比，这是唯一能证明「没丢数据」的东西。

同时确认 C 盘空间：

```
powershell -NoProfile -Command "Get-PSDrive C | ForEach-Object { '{0:N2} GB free' -f ($_.Free/1GB) }"
```

需要 **≥ 10 GB**（7.99 GB 镜像 + 余量）。

---

## 第 1 步 · 完全退出应用

**不是关窗口，是退出。** 右键任务栏图标 → 退出；再打开任务管理器确认没有残留的
`Claude.exe` / `claude.exe` 进程。VM 文件被占用时后面会失败。

> 从这里开始你看不到 AI 的说明了，所以把本文件留在屏幕上。

---

## 第 2 步 · 检查点 A：确认 D 盘内容在

```
dir "D:\Claude-3p-vm"
```

应当看到 `bundles` 和 `codevm` 两个目录。**看不到就停，别往下走。**

---

## 第 3 步 · 拆 junction（关键：不带 /s）

```
rmdir "C:\Users\Administrator\AppData\Local\Claude-3p\vm_bundles"
rmdir "C:\Users\Administrator\AppData\Local\Claude-3p\claude-code-vm"
```

> ⚠️ **绝对不要写 `rmdir /s` 或 `rd /s`。**
> 不带 `/s` 时 `rmdir` 对一个 junction 只删「链接本身」，D 盘里的真实内容一动不动。
> 带了 `/s`，在部分 Windows 版本上会**顺着链接把 D 盘真实目录也删掉**——那是 7.99 GB 的不可逆删除。

正常结果：两条命令都没输出。然后 `dir "C:\Users\Administrator\AppData\Local\Claude-3p"` 里
这两个名字应当**消失**。

---

## 第 4 步 · 检查点 B：再确认一次 D 盘内容还在

```
dir "D:\Claude-3p-vm"
```

**这一步是本次操作最重要的安全检查。** 如果这里看不到内容了，立刻停下、
不要执行第 5 步，把本文件内容发给 AI。

---

## 第 5 步 · 拷回 C 盘（只复制，不删源）

```
robocopy "D:\Claude-3p-vm\bundles" "C:\Users\Administrator\AppData\Local\Claude-3p\vm_bundles" /E
robocopy "D:\Claude-3p-vm\codevm"  "C:\Users\Administrator\AppData\Local\Claude-3p\claude-code-vm" /E
```

> · 只用 `/E`（含空目录），**不要用 `/MOVE`**——先复制、不删源，才有退路。
> · robocopy 的退出码 **0–7 都是成功**（1 表示「有文件被复制」，最常见）。
>   看到 `Exit code: 1` 不要慌；只有 **≥8** 才是真失败。

---

## 第 6 步 · 检查点 C：核对凭据

```
powershell -NoProfile -Command "Get-ChildItem 'C:\Users\Administrator\AppData\Local\Claude-3p\vm_bundles','C:\Users\Administrator\AppData\Local\Claude-3p\claude-code-vm' -Recurse -File | Measure-Object Length -Sum | ForEach-Object { 'TOTAL {0} bytes / {1} files' -f $_.Sum, $_.Count }"
```

**字节数和文件数必须与第 0 步的记录一致。** 不一致就停，别启动应用。

---

## 第 7 步 · 启动应用验证

打开 Claude 桌面应用，随便让我跑一条命令。判据：

- 恢复 → 成功，继续第 8 步。
- 仍报 `is a symlink or junction` → 说明**应用自己又在重建 junction**，那不是你留下的，
  停下告诉 AI（下一步要查配置层，别硬来）。
- 报**别的**错误 → 说明 junction 这道坎过了，是新问题，把原文发给 AI。

---

## 第 8 步 · 确认无误后回收 D 盘空间

**只在第 7 步确认沙盒真的恢复之后**才做：

```
rmdir "D:\Claude-3p-vm\bundles" /s /q
rmdir "D:\Claude-3p-vm\codevm" /s /q
rmdir "D:\Claude-3p-vm"
```

此时这两个路径已经是普通真实目录（不再是链接），`/s` 才是安全的。
拿不准就先不删，D 盘那 8 GB 放着不会坏事。

---

## 回退方法（任何一步想退回去）

如果拆了 junction 但想恢复原状：

```
mklink /J "C:\Users\Administrator\AppData\Local\Claude-3p\vm_bundles"     "D:\Claude-3p-vm\bundles"
mklink /J "C:\Users\Administrator\AppData\Local\Claude-3p\claude-code-vm" "D:\Claude-3p-vm\codevm"
```

（前提：第 3 步拆掉链接后**没删** D 盘内容，且第 5 步没往 C 盘写过东西。
若已拷过，先删掉 C 盘那两个真实目录再重建链接。）
