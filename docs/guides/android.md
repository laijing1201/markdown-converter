# MarkDoc 安卓端（Capacitor）

> MarkDoc 的安卓端**不维护第二套业务代码**：它复用与 GitHub Pages 完全相同的
> `npm run build:web` 产物（vite `base: './'` 相对路径设计，在 Capacitor WebView
> 的 `https://localhost` 下同样可用）。因此**所有功能天然同步**——转换管线
> （Word OMML 公式 / 真文本 PDF）、三套模板、AI 对话链接导入、批量转换、
> 账号体系与云端历史、本地历史，全部与 Web 版一致。

## 两种安装形态

| 形态 | 需要构建 | 适合场景 |
|------|----------|----------|
| **PWA「添加到主屏幕」** | 不需要 | 任何用户，安卓 Chrome 打开线上站点 → 菜单 → 「添加到应用/添加到主屏幕」，即得全屏图标 + 离线启动 |
| **APK（Capacitor 壳）** | 需要 Android Studio | 分发安装包、上架应用市场、需要启动图与原生图标的正式产品形态 |

两者跑的是同一份 Web 代码，功能完全一致；APK 额外提供原生启动屏、系统分享面板导出、独立应用进程。

## 架构说明（为什么功能全同步）

```text
                    MarkDoc Core（src/core/*）         ← 转换/账号/历史，四端共用
                         │
       ┌─────────────────┼─────────────────┬──────────────┐
       ▼                 ▼                 ▼              ▼
   Web(PWA)          Desktop(Electron)   Extension     Android(Capacitor)
   浏览器下载          原生另存为           浏览器下载     写缓存 + 系统分享面板
                    └────────── src/platform/* 平台层 ──────────┘
```

- 安卓差异只有一处：**文件导出**。安卓 WebView 不响应 `<a download>`，
  `src/platform/capacitor.ts` 把导出（Word / PDF / 批量 ZIP / 质量报告 / 账号数据）
  改为「写入应用缓存目录 → 弹出系统分享面板」：用户选「保存到文件」即等同下载，
  也可直接发微信 / 邮件 / 传到电脑。
- 打开本地 `.md` 文件走通用 `<input type="file">`，Capacitor 自动桥接系统文件选择器。
- Service Worker 只在 Web 端注册（安卓壳内跳过，避免干扰资源更新）。

## 环境准备（构建 APK 才需要）

1. 安装 [Android Studio](https://developer.android.com/studio)（自带 JDK 17 与 SDK 管理器）
2. 首次启动 Android Studio → 打开项目 `android/` 目录 → 按提示自动安装缺失的
   SDK Platform / Build-Tools（一路 Next）
3. 或者不装 Studio：手装 JDK 17 + Android SDK，并设置 `JAVA_HOME` / `ANDROID_HOME`

> 本仓库不强制提交 `android/local.properties`（SDK 路径），它由 Android Studio 自动生成。

## 常用命令

```bash
npm install              # 首次：装 npm 依赖（含 @capacitor/*）

npm run android:sync     # 构建 Web 产物（build:web）并同步进 android 工程
npm run android:open     # 用 Android Studio 打开 android 工程（Run ▶ 即可装机）
npm run android:run      # sync 后直接在连接的真机/模拟器上运行
npm run android:apk      # 出 Debug APK：android/app/build/outputs/apk/debug/app-debug.apk
```

改了 `src/` 下任何代码 → 重新 `npm run android:sync`（或 `android:run`）即可，
**永远不要直接改 `android/app/src/main/assets/public/` 里的文件**（每次 sync 全量覆盖）。

## 改动 App 名称 / 包名 / 图标

- 名称与包名：`capacitor.config.ts`（`appName` / `appId`）→ 改后 `android:sync`。
  包名已定 `com.markdoc.app`，上架前如需改包名，直接改配置后删掉 `android/` 重新
  `npx cap add android`（native 工程是生成物，随时可重建）。
- 图标与启动图：把新图替换 `assets/icon-only.png`（1024×1024）与
  `assets/splash.png`（2732×2732），然后：

  ```bash
  npx @capacitor/assets generate --android \
    --iconBackgroundColor "#ffffff" --splashBackgroundColor "#ffffff" \
    --iconBackgroundColorDark "#1f2937" --splashBackgroundColorDark "#111827"
  ```

- PWA 图标（Web 端安装用）：`npm run icons:pwa`（源图 `public/icon-v3.png`，
  实际是 JPEG，由 Chrome canvas 转码出各尺寸 PNG）。

## 正式发布（release APK / AAB）

1. 生成签名密钥（**不要提交进 git**，`.gitignore` 已忽略 `*.jks` / `*.keystore`）：

   ```bash
   keytool -genkey -v -keystore markdoc-release.keystore -alias markdoc \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. 在 `android/key.properties` 写入路径与密码，并在 `android/app/build.gradle`
   配置 signingConfigs（Android Studio 新建工程向导也可代劳）
3. `cd android && ./gradlew bundleRelease`（AAB，上架 Google Play 用）或
   `./gradlew assembleRelease`（直接分发的 APK）
4. 版本号：`android/app/build.gradle` 的 `versionCode` / `versionName`
   （建议与 `package.json` 的 `version` 保持一致）

## 已知边界（诚实清单）

- **邮箱确认 / 找回密码链接**：Supabase 发的链接在浏览器打开并落在 Web 站点上；
  在 App 内完成登录后，云端历史与 App 共用同一账号，数据不丢。App 内登录本身
  （邮箱+密码）直接在 WebView 中完成，无跳转。
- **管理后台（admin.html）** 是桌面运营工具，随 Web 部署，不进安卓 App 主流程
  （文件在包内可访问，但界面按桌面宽度设计）。
- PWA 与 APK 的本地数据（本地历史、设置）各自独立存储，与浏览器之间不互通；
  **云端历史随账号互通**，这是跨设备迁移的推荐路径。
