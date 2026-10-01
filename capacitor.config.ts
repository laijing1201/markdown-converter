import type { CapacitorConfig } from '@capacitor/cli'

/**
 * MarkDoc 安卓壳（Capacitor）配置。
 *
 * 安卓端不维护第二套业务代码：webDir 指向与 GitHub Pages 完全相同的
 * `npm run build:web` 产物（vite base: './' 相对路径，在 WebView 的
 * https://localhost 下同样可用），转换管线、账号体系、云端历史全部同步。
 *
 * 常用命令（详见 docs/android.md）：
 *   npm run android:sync   构建 Web + 同步进 android 工程
 *   npm run android:open   用 Android Studio 打开
 *   npm run android:run    真机/模拟器运行
 *   npm run android:apk    出 Debug APK
 */
const config: CapacitorConfig = {
  appId: 'com.markdoc.app',
  appName: 'MarkDoc',
  webDir: 'dist',
  // WebView 内以 https://localhost 提供 Web 资源：Cache API / Clipboard /
  // SubtleCrypto 等安全上下文 API 与线上站点行为一致（PDF 字体子集化依赖它们）
  server: {
    androidScheme: 'https',
  },
}

export default config
