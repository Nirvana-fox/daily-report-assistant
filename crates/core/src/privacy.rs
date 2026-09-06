//! 本地敏感信息脱敏兜底。
//!
//! 视觉模型的系统提示词已要求脱敏（见 `watch::VISION_SYSTEM_PROMPT`），
//! 但 LLM 可能漏网；本模块在**入库前**对 title / summary / keywords 再做
//! 一道本地正则过滤，把手机号、邮箱、证件号、密钥、内网地址等替换为占位符。
//!
//! 设计原则：宁可误伤（把普通数字串当成卡号）也不放过敏感字段；
//! 替换是幂等的（占位符本身不会再命中任何规则）。

use std::sync::OnceLock;

use regex::Regex;

/// 脱敏规则表：(编译后的正则, 替换占位符)。
/// 用 [`OnceLock`] 保证只编译一次。
///
/// 注：`regex` crate 不支持 look-around，"前后不能是数字"的约束
/// 用 `(^|\D) ... (\D|$)` 捕获组实现（替换时保留 `$1`/`$3`）。
fn rules() -> &'static Vec<(Regex, &'static str)> {
    static RULES: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    RULES.get_or_init(|| {
        vec![
            // 邮箱
            (
                Regex::new(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap(),
                "[邮箱]",
            ),
            // 大陆手机号（1[3-9] 开头 11 位，前后不能是数字）
            (
                Regex::new(r"(^|\D)(1[3-9]\d{9})(\D|$)").unwrap(),
                "$1[手机号]$3",
            ),
            // 座机（区号-号码，如 010-12345678 / 0755-1234567）
            (Regex::new(r"\b0\d{2,3}-\d{7,8}\b").unwrap(), "[电话]"),
            // 身份证（18 位，末位可 X）
            (
                Regex::new(r"(^|\D)(\d{17}[\dXx])(\D|$)").unwrap(),
                "$1[证件号]$3",
            ),
            // 常见密钥形态：sk- / pk- / rk- 开头、Bearer token、AKIA 开头
            (
                Regex::new(r"(?i)\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}").unwrap(),
                "[密钥]",
            ),
            (
                Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{16,}").unwrap(),
                "[凭证]",
            ),
            (Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap(), "[密钥]"),
            // key=value 形态的敏感字段（token/secret/password/api_key ...）
            (
                Regex::new(
                    r#"(?i)\b(access[_-]?token|api[_-]?key|apikey|secret|token|password|passwd|pwd|authorization|cookie|session[_-]?id)\b["']?\s*[:=]\s*["']?[^\s"',;&]{4,}["']?"#,
                )
                .unwrap(),
                "$1=[已脱敏]",
            ),
            // 银联卡号（62 开头 16-19 位，前后不能是数字）
            (
                Regex::new(r"(^|\D)(62\d{14,17})(\D|$)").unwrap(),
                "$1[卡号]$3",
            ),
            // IPv4（含内网/公网；对日报价值低且可能泄露内网拓扑）
            (
                Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap(),
                "[IP地址]",
            ),
            // URL 查询串里的敏感参数（token=... / ticket=...）
            (
                Regex::new(r"(?i)(\?|&)(token|ticket|sessionid|sid|code)=[^\s&]+").unwrap(),
                "$1$2=[已脱敏]",
            ),
        ]
    })
}

/// 对文本应用全部脱敏规则。
///
/// 多轮应用直到不再变化（规则之间可能互相制造新命中，如先替换出
/// `[密钥]` 后又被 IP 规则误伤——循环最多 3 轮，防御性设计）。
pub fn sanitize(input: &str) -> String {
    let mut text = input.to_string();
    for _ in 0..3 {
        let mut changed = false;
        for (re, replacement) in rules() {
            let after = re.replace_all(&text, *replacement).to_string();
            if after != text {
                text = after;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    text
}

/// 便捷版本：同时清洗多段文本（原地修改切片内容）。
pub fn sanitize_all(inputs: &mut [String]) {
    for s in inputs.iter_mut() {
        *s = sanitize(s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_common_sensitive_fields() {
        let cases = [
            ("联系 13812345678 确认", "联系 [手机号] 确认"),
            ("发到 zhang.san@example.com.cn", "发到 [邮箱]"),
            ("身份证 11010119900307851X", "身份证 [证件号]"),
            ("key: sk-abcdef1234567890abcd", "key: [密钥]"),
            // authorization 命中 key=value 规则（同为有效脱敏路径）
            ("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5", "Authorization=[已脱敏]"),
            ("Bearer eyJhbGciOiJIUzI1NiIsInR5", "[凭证]"),
            ("password = 'p@ssw0rd123'", "password=[已脱敏]"),
            ("api_key: abc123def456", "api_key=[已脱敏]"),
            ("卡号 6222020200112233445", "卡号 [卡号]"),
            ("访问 192.168.31.200:8088", "访问 [IP地址]:8088"),
        ];
        for (input, expect) in cases {
            assert_eq!(sanitize(input), expect, "input: {input}");
        }
    }

    #[test]
    fn keeps_normal_work_content() {
        let normal = "正在调试 NAS 同步模块，修复了 update_work_log_meta 的并发问题";
        assert_eq!(sanitize(normal), normal);

        let nums = "版本 1.4.0，间隔 600 秒，共 32 条记录";
        assert_eq!(sanitize(nums), nums);
    }

    #[test]
    fn idempotent_on_placeholders() {
        let once = sanitize("邮箱 test@a.com 和手机 13912345678");
        let twice = sanitize(&once);
        assert_eq!(once, twice);
    }
}
