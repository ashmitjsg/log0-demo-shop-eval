package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type scriptedGateway struct {
	errs  []error
	calls int
}

func (g *scriptedGateway) Charge(string, int) (string, error) {
	i := g.calls
	g.calls++
	if i < len(g.errs) && g.errs[i] != nil {
		return "", g.errs[i]
	}
	return "ch_ok", nil
}

func noSleep(p retryPolicy, slept *[]time.Duration) retryPolicy {
	p.sleep = func(d time.Duration) { *slept = append(*slept, d) }
	return p
}

func TestRetryWaitsLongerEachTimeAndThenSucceeds(t *testing.T) {
	var slept []time.Duration
	g := &scriptedGateway{errs: []error{errUnavailable, errUnavailable}}
	id, err := chargeWithRetry(g, noSleep(defaultRetry(), &slept), "o1", 500)
	if err != nil || id != "ch_ok" {
		t.Fatalf("got %q, %v", id, err)
	}
	if g.calls != 3 || len(slept) != 2 {
		t.Fatalf("calls=%d sleeps=%d", g.calls, len(slept))
	}
	if slept[0] < 100*time.Millisecond || slept[1] < 200*time.Millisecond {
		t.Fatalf("backoff did not grow: %v", slept)
	}
}

func TestRetryGivesUpAfterTheConfiguredAttempts(t *testing.T) {
	var slept []time.Duration
	g := &scriptedGateway{errs: []error{errUnavailable, errUnavailable, errUnavailable, errUnavailable}}
	_, err := chargeWithRetry(g, noSleep(defaultRetry(), &slept), "o1", 500)
	if !errors.Is(err, errUnavailable) || g.calls != 3 {
		t.Fatalf("err=%v calls=%d", err, g.calls)
	}
}

func TestBadCredentialsAreNeverRetried(t *testing.T) {
	var slept []time.Duration
	g := &scriptedGateway{errs: []error{errBadCreds}}
	_, err := chargeWithRetry(g, noSleep(defaultRetry(), &slept), "o1", 500)
	if !errors.Is(err, errBadCreds) || g.calls != 1 || len(slept) != 0 {
		t.Fatalf("err=%v calls=%d sleeps=%d", err, g.calls, len(slept))
	}
}

func TestStoreRemembersResults(t *testing.T) {
	s := NewStore()
	if _, ok := s.Get("k"); ok {
		t.Fatal("empty store returned a result")
	}
	s.Put("k", Result{ChargeID: "ch_1", AmountCents: 12000})
	if r, ok := s.Get("k"); !ok || r.ChargeID != "ch_1" {
		t.Fatalf("got %v %v", r, ok)
	}
}

func newTestServer(g Gateway) *server {
	return &server{gateway: g, store: NewStore(), retry: retryPolicy{attempts: 3, base: time.Millisecond, sleep: func(time.Duration) {}}, fake: newFakeGateway("k")}
}

func post(t *testing.T, h http.Handler, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/charge", bytes.NewReader(b)))
	return rec
}

func TestChargeHappyPathAndValidation(t *testing.T) {
	h := newMux(newTestServer(&scriptedGateway{}))
	if rec := post(t, h, map[string]any{"orderId": "o1", "amountCents": 2500, "idempotencyKey": "k1"}); rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if rec := post(t, h, map[string]any{"orderId": "", "amountCents": 0}); rec.Code != 400 {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestAHighValueChargeIsNotRepeatedForTheSameKey(t *testing.T) {
	g := &scriptedGateway{}
	h := newMux(newTestServer(g))
	body := map[string]any{"orderId": "o1", "amountCents": 25000, "idempotencyKey": "same"}
	post(t, h, body)
	rec := post(t, h, body)
	if rec.Code != 200 || g.calls != 1 {
		t.Fatalf("status %d, gateway called %d times", rec.Code, g.calls)
	}
}

func TestAGatewayFailureIsABadGatewayNotACrash(t *testing.T) {
	h := newMux(newTestServer(&scriptedGateway{errs: []error{errBadCreds}}))
	if rec := post(t, h, map[string]any{"orderId": "o1", "amountCents": 2500}); rec.Code != 502 {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestAPanicInAHandlerBecomesA500(t *testing.T) {
	h := recoverPanics(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != 500 {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestLogEventShape(t *testing.T) {
	e := buildEvent("ERROR", "boom", "trace here")
	if e.Level != "ERROR" || e.Trace != "trace here" {
		t.Fatalf("%+v", e)
	}
	if _, err := time.Parse(time.RFC3339Nano, e.Timestamp); err != nil {
		t.Fatal(err)
	}
}
