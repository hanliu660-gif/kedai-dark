// Mock 连接器的逐字流式节流（2026-10-31 提效批，对齐上游 #63 的做法）。
//
// 拆成独立模块的理由：
//   1. 与「回复内容编排」无耦合，判据是**构建配置 × 环境变量**的复合；
//   2. 事故面在「测试为什么突然又慢了」——单独成文比塞在两千行文件中部更容易被找到。
//
// ## 为什么需要这个模块（踩坑记录）
//
// 改前：mock 的逐字流式循环**每字符 `sleep(8ms)`**，测试里也照样执行。
// 一条 330 字的回复 = 2.6s 纯等待，与「测什么」无关；集成测试累计起来是分钟级浪费。
//
// ⚠️ **关键陷阱（上游实测，第一版推断被证伪）**：
// 把延时改成 `Duration::ZERO` **并不够** —— Windows 上 `tokio::time::sleep(Duration::ZERO)`
// 仍会消耗一个约 8ms 的定时器周期。上游第一版这么改，489s 只降到 454s（仅 7%）。
// **正确做法是跳过 `sleep` 调用本身**（见 `mock.rs` 的 `if delay.is_zero() { continue }`）。
use std::sync::OnceLock;
use std::time::Duration;

use crate::models::types::LlmMessage;

/// 慢流哨兵：消息含该子串时，该轮生成强制走 8ms/字符。
///
/// 用途：需要「生成仍在进行中」时间窗口的测试用例，显式申请慢流——
/// 窗口由用例自己声明，与其他用例的默认零延时解耦（不靠墙钟赌博）。
///
/// 用无括号形式，是因为它可能嵌进计划 JSON 的 goal 字符串，而 `reply_if` 等钩子
/// 按「首个 `]]`」截断内容——带括号的标记会被当成结束符把内容截断。
pub(crate) const SLOW_STREAM_SENTINEL: &str = "__KEDAI_SLOW_STREAM__";

/// 本轮该用的字符间延时（mock 生成循环的唯一入口）。
///
/// 判据扫**全部消息**而非只扫最后一条 user：custom 流程会把任务 goal 渲染进
/// system 提示词，只看 user 消息会漏掉哨兵。
pub(crate) fn char_delay_for(messages: &[LlmMessage]) -> Duration {
    if messages
        .iter()
        .any(|m| m.content.contains(SLOW_STREAM_SENTINEL))
    {
        Duration::from_millis(8)
    } else {
        mock_char_delay()
    }
}

/// 逐字流式的字符间延时（生产/演示默认 8ms；测试构建默认零延时）。
///
/// 判据：
/// - `cfg(test)` 覆盖 lib 单元的测试；
/// - `feature = "test-support"` 覆盖 `tests/**` 集成测试（独立 crate，看不到 `cfg(test)`）；
/// - 两处都不命中 ⇒ 生产/演示构建，保留 8ms 手感（观感与改前完全一致）；
/// - `KEDAI_MOCK_CHAR_DELAY_MS` 环境变量**始终可覆盖**（便于排查慢流问题）。
pub(crate) fn mock_char_delay() -> Duration {
    static DELAY: OnceLock<Duration> = OnceLock::new();
    *DELAY.get_or_init(|| {
        let in_test_build = cfg!(any(test, feature = "test-support"));
        if in_test_build && std::env::var_os("KEDAI_MOCK_CHAR_DELAY_MS").is_none() {
            return Duration::ZERO;
        }
        std::env::var("KEDAI_MOCK_CHAR_DELAY_MS")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .map(Duration::from_millis)
            .unwrap_or(Duration::from_millis(8))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentinel_forces_slow_stream_even_in_test_build() {
        // 测试构建默认零延时，但带哨兵必须强制 8ms（保留慢流测试能力）
        let with_sentinel = vec![LlmMessage::plain(
            "system",
            &format!("任务目标：{SLOW_STREAM_SENTINEL}"),
        )];
        assert_eq!(char_delay_for(&with_sentinel), Duration::from_millis(8));

        let plain = vec![LlmMessage::plain("user", "普通消息")];
        assert_eq!(char_delay_for(&plain), Duration::ZERO);
    }

    #[test]
    fn sentinel_matches_when_only_in_system_message() {
        // 哨兵可能只出现在 system（custom 流程把 goal 渲染进 system）
        let msgs = vec![
            LlmMessage::plain("system", SLOW_STREAM_SENTINEL),
            LlmMessage::plain("user", "普通"),
        ];
        assert_eq!(char_delay_for(&msgs), Duration::from_millis(8));
    }
}
