package com.kedai.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.view.View
import androidx.annotation.Keep
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import java.io.File
import java.lang.ref.WeakReference

/**
 * Kedai 原生能力桥接(供 Rust 侧经 JNI 调用)。
 *
 * 与 [KeystoreBridge] 同一模式:Rust 只做字符串进出,Kotlin 侧封装 Android API。
 * 五项能力:
 *   - openExternal(url):用系统浏览器打开外链。WebView 里 `target=_blank` 在
 *     Android 上没有新窗口处理,会被当作当前页导航,把 SPA 界面顶掉且返回键无处可退;
 *     改为交给系统浏览器,行为与桌面一致。
 *   - shareFile(payload):把导出内容写入缓存目录后经 FileProvider 弹系统分享选单。
 *     Android 的文件保存是 SAF(content:// URI)语义,插件 fs 的路径写入不适用;
 *     「写缓存 + 分享」是移动端导出 JSON 的标准做法。
 *   - startKeepAlive() / stopKeepAlive():启停前台服务,避免长任务在切后台/锁屏后
 *     被系统冻结或回收。
 *   - setSystemBars(mode):把状态栏/导航栏(以及 edge-to-edge 下那圈 insets 留白区)
 *     的配色切到应用当前主题。web 侧主题与 Android 系统深浅色是两套独立开关,
 *     不同步就会出现「应用全黑、上下两条浅粉边」(真机截图确认)。
 *
 * 入参约定(与 server-rs/src/services/native_bridge_android.rs 对齐):
 *   - openExternal:入参即 URL;
 *   - shareFile:入参为 "文件名\u{1f}内容"(US 单元分隔符);
 *   - keepalive*:入参为空串;
 *   - setSystemBars:入参为 "dark" 或 "light"。
 * 全部返回 "" 表成功;异常抛出由 Rust 侧转为错误。
 *
 * ⚠️ 混淆约束:本类被 native 按名调用(FindClass / CallStaticMethod),
 * release 的 R8 若重命名会导致运行时失败。双保险:`@Keep` 注解 +
 * app/proguard-rules.pro 里 `-keep class com.kedai.app.KedaiNative { *; }`。
 */
@Keep
object KedaiNative {
    private const val SEP = '\u001f'

    /** 应用上下文(在 MainActivity.onCreate 中注入) */
    @Volatile
    private var appContext: Context? = null

    /**
     * 当前 Activity 的弱引用(在 MainActivity.onCreate 中注入)。
     * 系统栏配色只能经 Activity 的 window 改,applicationContext 做不到;
     * 用弱引用避免桥类把 Activity 钉住造成泄漏(Activity 重建时由后一次注入覆盖)。
     */
    @Volatile
    private var activityRef: WeakReference<Activity>? = null

    /** 由 MainActivity 在启动时注入应用上下文(未注入时抛异常,由 Rust 侧转成可见错误) */
    fun attach(context: Context) {
        appContext = context.applicationContext
    }

    /** 由 MainActivity 在启动时注入 Activity(系统栏配色需要 window,见 [setSystemBars]) */
    fun attachActivity(activity: Activity) {
        activityRef = WeakReference(activity)
        // Activity 重建(旋转/分屏)后窗口是新的,把上次下发的配色重放一遍
        if (systemBarsMode != null) activity.runOnUiThread { applySystemBars(activity) }
    }

    private fun requireContext(): Context =
        appContext ?: throw IllegalStateException("KedaiNative 未初始化:MainActivity 未注入 Context")

    /**
     * 取应用上下文(未注入时返回 null)。供 [ShellExecutorBridge] 等兄弟桥类做
     * 「可用性探测」——探测路径不应因上下文缺失而抛异常(抛了会让整段探测失败)。
     */
    @JvmStatic
    @Keep
    fun appContextOrNull(): Context? = appContext

    /** 用系统浏览器打开外链 */
    @JvmStatic
    @Keep
    fun openExternal(url: String): String {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) throw IllegalArgumentException("外链为空")
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(trimmed)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        requireContext().startActivity(intent)
        return ""
    }

    /** 分享文本为文件:写缓存目录 → FileProvider URI → 系统分享选单 */
    @JvmStatic
    @Keep
    fun shareFile(payload: String): String {
        val idx = payload.indexOf(SEP)
        val name = if (idx >= 0) payload.substring(0, idx) else payload
        val content = if (idx >= 0) payload.substring(idx + 1) else ""
        if (name.isBlank()) throw IllegalArgumentException("导出文件名为空")

        val context = requireContext()
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        // 文件名去掉路径分隔符,避免目录穿越
        val safeName = name.replace('/', '_').replace('\\', '_')
        val file = File(dir, safeName)
        file.writeText(content, Charsets.UTF_8)

        val uri: Uri = FileProvider.getUriForFile(
            context,
            context.packageName + ".fileprovider",
            file,
        )
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, safeName)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(intent, "导出到").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(chooser)
        return ""
    }

    /** 启动前台服务(长任务保活);重复调用幂等 */
    @JvmStatic
    @Keep
    fun startKeepAlive(): String {
        KeepAliveService.start(requireContext())
        return ""
    }

    /** 停止前台服务保活;重复调用幂等 */
    @JvmStatic
    @Keep
    fun stopKeepAlive(): String {
        KeepAliveService.stop(requireContext())
        return ""
    }

    /** 最后一次下发的系统栏模式("dark" / "light"),Activity 重建后据此重放 */
    @Volatile
    private var systemBarsMode: String? = null

    /**
     * 切换系统栏配色(状态栏/导航栏图标明暗 + edge-to-edge 留白区底色)。
     *
     * 为什么必须走原生:targetSdk 36 强制 edge-to-edge 后,web 内容铺满整屏,
     * 状态栏与手势条下面那圈是 [MainActivity] 给内容根视图加的 insets padding,
     * 画的是**原生视图的背景**,CSS 完全够不到 —— 不在这里改,深色主题下就是
     * 上下两条浅粉边。
     *
     * 入参 "dark" / "light"(与 web/src/theme.ts 的 data-theme 一致)。
     * 未注入 Activity(理论上不该发生)时静默返回,不让 JNI 侧报错影响主题切换。
     */
    @JvmStatic
    @Keep
    fun setSystemBars(mode: String): String {
        val dark = mode.trim() == "dark"
        systemBarsMode = if (dark) "dark" else "light"
        val activity = activityRef?.get() ?: return ""
        activity.runOnUiThread { applySystemBars(activity) }
        return ""
    }

    /** 把 [systemBarsMode] 落到当前 Activity 的窗口上(必须在 UI 线程调用) */
    @Suppress("DEPRECATION") // statusBarColor / navigationBarColor 在 API 35 起被标记废弃,低版本仍需设
    private fun applySystemBars(activity: Activity) {
        val dark = systemBarsMode == "dark"
        val color = ContextCompat.getColor(
            activity,
            if (dark) R.color.kedai_paper_dark else R.color.kedai_paper,
        )
        val window = activity.window
        // 1) 内容根视图:insets padding 就是它的内边距,那圈「边」画的正是它的背景
        val content = activity.findViewById<View>(android.R.id.content)
        content?.setBackgroundColor(color)
        // 2) 窗口背景:启动/转场瞬间、以及系统栏自身透明处透出的底色
        window.setBackgroundDrawable(ColorDrawable(color))
        // 3) 图标明暗:深底配浅图标,浅底配深图标(否则深色主题下看不清时间/信号)
        WindowCompat.getInsetsController(window, content ?: window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
        // 4) Android 15+ 起这两行已无效(强制透明),低版本仍有效,顺手设;
        //    Android 10+ 关掉导航栏的半透明遮罩,免得深色下又被提亮一档。
        window.statusBarColor = color
        window.navigationBarColor = color
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
    }
}
