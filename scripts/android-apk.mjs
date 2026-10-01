/**
 * 构建 Android Debug APK（跨平台入口）：
 *
 *   npm run android:apk
 *
 * 内部执行 android/gradlew assembleDebug（Windows 用 gradlew.bat）。
 * 需要 JDK 17 与 Android SDK——最简单的获取方式是安装 Android Studio
 * （它自带 JDK 与 SDK 管理器），首次打开 android/ 工程按提示装齐即可。
 * 产物：android/app/build/outputs/apk/debug/app-debug.apk
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const ANDROID = join(ROOT, 'android')

if (!existsSync(join(ANDROID, 'gradlew.bat')) && !existsSync(join(ANDROID, 'gradlew'))) {
  console.error('✗ 未找到 android/ 工程（gradlew 缺失）。先在仓库根目录执行：npm install && npx cap add android')
  process.exit(1)
}

if (!process.env.JAVA_HOME && !existsSync('C:/Program Files/Android/Android Studio/jbr')) {
  console.error(
    '✗ 未检测到 JDK。请安装 Android Studio（自带 JDK 17），或设置 JAVA_HOME 指向 JDK 17。\n' +
      '  详见 docs/android.md「环境准备」一节。',
  )
  process.exit(1)
}

const isWin = process.platform === 'win32'
const gradlew = isWin ? 'gradlew.bat' : './gradlew'

console.log(`▶ ${gradlew} assembleDebug`)
const res = spawnSync(isWin ? gradlew : gradlew, ['assembleDebug', '--console=plain'], {
  cwd: ANDROID,
  stdio: 'inherit',
  shell: isWin, // Windows 下让 shell 解析 gradlew.bat
})

if (res.error) {
  console.error(`✗ gradle 启动失败：${res.error.message}`)
  process.exit(1)
}
if (res.status !== 0) {
  console.error('✗ APK 构建失败（上方为 gradle 日志）。常见原因：未装 Android SDK 对应平台/构建工具，用 Android Studio 打开 android/ 按提示安装。')
  process.exit(res.status ?? 1)
}

const apk = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
if (existsSync(apk)) {
  console.log(`\n✅ Debug APK 已生成：${apk}\n   传到手机安装即可（设置里允许「安装未知来源应用」）。`)
} else {
  console.warn('\n⚠ gradle 报告成功但未找到 app-debug.apk，请检查 android/app/build/outputs/apk/debug/')
}
