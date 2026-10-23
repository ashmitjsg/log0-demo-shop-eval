package main

// Ships log events to log0 (https://log0.in). The contract is plain HTTP, so any language can do it:
//
//	POST {LOG0_URL}/api/v1/logs
//	headers  X-API-KEY, X-SERVICE-NAME, X-ENVIRONMENT
//	body     {"timestamp": ISO-8601, "level": "ERROR", "message": "...", "trace": "stack trace, optional"}
//
// Events are also printed to stdout as JSON. Shipping never blocks a request and never fails it.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type logEvent struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	Trace     string `json:"trace,omitempty"`
}

var levelOrder = map[string]int{"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3, "FATAL": 4}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	log0URL     = os.Getenv("LOG0_URL")
	log0Key     = os.Getenv("LOG0_API_KEY")
	serviceName = env("LOG0_SERVICE", "payments")
	environment = env("LOG0_ENV", "demo")
	minLevel    = levelOrder[env("LOG0_MIN_LEVEL", "WARN")]
	shipClient  = &http.Client{Timeout: 2 * time.Second}
)

func buildEvent(level, message, trace string) logEvent {
	if len(message) > 9000 {
		message = message[:9000]
	}
	if len(trace) > 90000 {
		trace = trace[:90000]
	}
	return logEvent{Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Level: level, Message: message, Trace: trace}
}

func logAt(level, message, trace string) {
	event := buildEvent(level, message, trace)
	line, _ := json.Marshal(map[string]string{"timestamp": event.Timestamp, "level": level, "message": event.Message, "service": serviceName})
	fmt.Println(string(line))
	if log0URL == "" || log0Key == "" || levelOrder[level] < minLevel {
		return
	}
	body, _ := json.Marshal(event)
	go func() {
		req, err := http.NewRequest(http.MethodPost, log0URL+"/api/v1/logs", bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-KEY", log0Key)
		req.Header.Set("X-SERVICE-NAME", serviceName)
		req.Header.Set("X-ENVIRONMENT", environment)
		if resp, err := shipClient.Do(req); err == nil {
			resp.Body.Close()
		}
	}()
}

func logInfo(format string, args ...any)  { logAt("INFO", fmt.Sprintf(format, args...), "") }
func logWarn(format string, args ...any)  { logAt("WARN", fmt.Sprintf(format, args...), "") }
func logError(format string, args ...any) { logAt("ERROR", fmt.Sprintf(format, args...), "") }
