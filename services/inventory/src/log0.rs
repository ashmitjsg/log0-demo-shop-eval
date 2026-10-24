//! Ships log events to log0 (https://log0.in). The contract is plain HTTP, so any language can do it:
//!
//!   POST {LOG0_URL}/api/v1/logs
//!   headers  X-API-KEY, X-SERVICE-NAME, X-ENVIRONMENT
//!   body     {"timestamp": ISO-8601, "level": "ERROR", "message": "...", "trace": "stack trace, optional"}
//!
//! Events are also printed to stdout as JSON. Shipping never blocks a request and never fails it.

use std::env;
use std::time::Duration;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const ORDER: [&str; 5] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

fn setting(key: &str, fallback: &str) -> String {
    env::var(key).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| fallback.to_string())
}

fn rank(level: &str) -> usize {
    ORDER.iter().position(|l| *l == level).unwrap_or(0)
}

pub fn build_event(level: &str, message: &str, trace: Option<&str>) -> serde_json::Value {
    let mut event = serde_json::json!({
        "timestamp": OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default(),
        "level": level,
        "message": message.chars().take(9000).collect::<String>(),
    });
    if let Some(trace) = trace {
        event["trace"] = serde_json::Value::String(trace.chars().take(90000).collect());
    }
    event
}

pub fn log(level: &str, message: &str, trace: Option<&str>) {
    let event = build_event(level, message, trace);
    println!(
        "{}",
        serde_json::json!({"timestamp": event["timestamp"], "level": level, "message": event["message"], "service": setting("LOG0_SERVICE", "inventory")})
    );
    let (url, key) = (setting("LOG0_URL", ""), setting("LOG0_API_KEY", ""));
    if url.is_empty() || key.is_empty() || rank(level) < rank(&setting("LOG0_MIN_LEVEL", "WARN")) {
        return;
    }
    let service = setting("LOG0_SERVICE", "inventory");
    let environment = setting("LOG0_ENV", "demo");
    std::thread::spawn(move || {
        let _ = ureq::post(&format!("{url}/api/v1/logs"))
            .set("X-API-KEY", &key)
            .set("X-SERVICE-NAME", &service)
            .set("X-ENVIRONMENT", &environment)
            .timeout(Duration::from_secs(2))
            .send_json(event);
    });
}

pub fn info(message: &str) {
    log("INFO", message, None);
}


/// Ship every panic with its backtrace, then let the default behaviour (the task dies) continue.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("<unnamed>");
        let location = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_default();
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_string());
        let trace = format!("thread '{name}' panicked at {location}:\n{payload}\nstack backtrace:\n{backtrace}");
        log("ERROR", &format!("thread panicked: {payload}"), Some(&trace));
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_carry_the_fields_log0_expects() {
        let plain = build_event("ERROR", "boom", None);
        assert_eq!(plain["level"], "ERROR");
        assert_eq!(plain["message"], "boom");
        assert!(plain.get("trace").is_none());
        assert!(OffsetDateTime::parse(plain["timestamp"].as_str().unwrap(), &Rfc3339).is_ok());
        assert_eq!(build_event("ERROR", "boom", Some("at x"))["trace"], "at x");
    }

    #[test]
    fn levels_are_ordered() {
        assert!(rank("ERROR") > rank("WARN"));
        assert!(rank("WARN") > rank("INFO"));
    }
}
