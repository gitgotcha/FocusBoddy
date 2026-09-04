# Abyssal Reverie · 深海绮梦

一个**完全离线**的 Windows 专注计时器（番茄钟）。深海海洋动态背景，界面安静克制，
数据 100% 存在你自己的电脑上，不联网、不上传、无账号。

- 当前版本：**v1.0.0**（2026-09-04）
- 系统要求：Windows 10 / 11，64 位
- 安装包内置 WebView2 运行时，**没有网络也能安装和使用**

---

## 一、下载与安装（新手照做即可）

### 方式 1：安装版（推荐）

1. 打开本仓库的 [Releases 页面](https://github.com/gitgotcha/abyssal-reverie/releases)。
2. 下载 `Abyssal Reverie_1.0.0_x64-setup.exe`（约 261 MB，内置运行时所以较大）。
3. 双击运行，一路点「下一步」直到完成（不需要管理员权限）。
4. 从开始菜单点击 **Abyssal Reverie** 启动。

> **如果 Windows 弹出蓝色警告「Windows 已保护你的电脑」**：
> 这是程序未做数字签名的常见提示，不是病毒。点击「更多信息」→「仍要运行」即可。
> 不放心的话，可先按下文校验文件 SHA-256。

### 方式 2：便携版（免安装）

1. 在 Releases 页面下载 `abyssal-reverie.exe`（约 20 MB，单文件）。
2. 放到任意文件夹（支持中文、空格路径），直接双击即可使用。
3. 不想要了？直接删除这个文件就行。

> 两个版本的数据是互通的（存在同一个位置），可以混用。

### 校验下载的文件没被篡改（可选）

按 `Win` 键 → 输入 `powershell` → 回车，粘贴（路径换成你的下载位置）：

```powershell
Get-FileHash "C:\Users\你\Downloads\Abyssal Reverie_1.0.0_x64-setup.exe" -Algorithm SHA256
```

安装版应为 `5ade6fd92dceedf9d0ecfdc137db98851e1ffead0e4cb27226721e9862afaeed`，
便携版应为 `8dde4a96338c958cb82418a5909fb7788880cca9c7c7194b6ec112bf37bb332b`。

---

## 二、第一次使用（3 步上手）

1. **开始专注**：主界面选好模式（专注 / 短休 / 长休），点大的播放按钮就开始倒计时。
2. **建个任务**（可选）：切到「任务」页 → 输入任务名 → 回车。专注前选中它，这次专注就记在这个任务名下。
3. **看统计**：右侧一栏是今日目标环和本周数据；「统计」页有周柱状图、项目分布、连续天数。

到时间会自动播放完成音效并弹通知；专注被打断就点「结束本次」，这类记录会标为
「已中止 · 不计入」，不会污染你的统计。

---

## 三、常用功能速查

| 想做什么 | 怎么做 |
|----------|--------|
| 最小化后继续计时 | 直接点窗口右上角 ✕，应用会驻留**系统托盘**（右下角），计时不停 |
| 从任何地方开始/暂停 | 全局快捷键 `Ctrl + Alt + Space` |
| 彻底退出应用 | 托盘图标右键 →「退出 Abyssal Reverie」。**若正在计时，会自动保存剩余时间并暂停**，下次打开手动「继续」即可，不会偷偷扣时间 |
| 电脑卡/省电 | 设置 → 打开「降低动态效果」，海洋背景会静止 |
| 换电脑迁移数据 | 设置 → 数据 →「导出」JSON 备份，在新机器上「导入」 |
| 只想要记录表格 | 「导出会话」可导出 CSV，用 Excel 打开 |
| 双击图标没反应 | 应用已经在运行了（单实例设计），看一眼右下角托盘 |

---

## 四、数据存在哪里？卸载会丢吗？

- 所有数据（任务、记录、设置）保存在：
  `C:\Users\你的用户名\AppData\Roaming\com.abyssalreverie.focus\`
- **升级、卸载都不会删除这个目录**，重装后数据原样回来。
- 想彻底清除：手动删除上面的文件夹即可。

---

## 五、常见问题（FAQ）

**Q：按 `Ctrl+Alt+Space` 没反应？**
该快捷键被其它程序占用了。重启本应用，顶部会出现提示横幅；关闭占用它的程序后再重启本应用即可恢复。

**Q：通知没有弹出来？**
检查 Windows 的「专注助手/勿扰模式」是否开启，以及设置里「桌面通知」是否打开。通知关闭不影响计时和统计。

**Q：杀毒软件/SmartScreen 拦截？**
程序未做商业数字签名，属于正常现象。校验过上方 SHA-256 一致即可放心使用。

**Q：能联网同步吗？**
不能，也不打算做——这是刻意的离线设计。换电脑请用「导出备份 / 导入」。

**Q：卸载后想彻底删除所有痕迹？**
卸载后手动删除第四节提到的数据文件夹。

---

## 六、从源码构建（开发者）

前置要求：Node.js 18+、pnpm、Rust（`x86_64-pc-windows-msvc` 工具链）。

```bash
pnpm install          # 安装前端依赖
pnpm tauri dev        # 开发模式运行
pnpm tauri build      # 产出正式安装包（src-tauri/target/release/bundle/nsis/）
pnpm test:run         # 前端测试；Rust 测试：cd src-tauri && cargo test
```

技术栈：Tauri 2 + React 19 + TypeScript + Vite + Rust + SQLite（rusqlite）。
计时以 Rust 端 `target_end_at` 时间戳推导，休眠/锁屏不漂移；数据层带 `user_version`
迁移、WAL、完整性检查与损坏自愈。

---

## 七、文档索引

| 文档 | 内容 |
|------|------|
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 版本变更日志 |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | 已知问题清单 |
| [docs/REGRESSION_REPORT.md](docs/REGRESSION_REPORT.md) | 完整回归测试报告（7 轮质量闸门） |
| [docs/ACCEPTANCE_GUIDE.md](docs/ACCEPTANCE_GUIDE.md) | 实机验收操作手册 |

---

## 八、许可证

本项目代码暂未附带开源许可证（保留所有权利）。如需以 MIT/Apache-2.0 等协议使用，
请提交 Issue 联系作者。
