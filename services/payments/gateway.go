package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"sync/atomic"
	"time"
)

var (
	errUnavailable = errors.New("payment gateway unavailable")
	errBadCreds    = errors.New("payment gateway rejected our credentials")
)

// Gateway charges a card somewhere. The demo runs a fake one inside this binary (see fakeGateway).
type Gateway interface {
	Charge(orderID string, amountCents int) (chargeID string, err error)
}

type httpGateway struct {
	url    string
	apiKey string
	client *http.Client
}

func newHTTPGateway(url, apiKey string) *httpGateway {
	return &httpGateway{url: url, apiKey: apiKey, client: &http.Client{Timeout: 3 * time.Second}}
}

func (g *httpGateway) Charge(orderID string, amountCents int) (string, error) {
	body, _ := json.Marshal(map[string]any{"orderId": orderID, "amountCents": amountCents})
	req, err := http.NewRequest(http.MethodPost, g.url+"/fake-gateway/charge", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+g.apiKey)
	resp, err := g.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: %v", errUnavailable, err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(resp.Body)
	switch resp.StatusCode {
	case http.StatusOK:
		var out struct {
			ChargeID string `json:"chargeId"`
		}
		if err := json.Unmarshal(payload, &out); err != nil {
			return "", err
		}
		return out.ChargeID, nil
	case http.StatusUnauthorized:
		return "", errBadCreds
	default:
		return "", fmt.Errorf("%w: status %d", errUnavailable, resp.StatusCode)
	}
}

// retryPolicy: how often and how patiently to retry a gateway that says it is unavailable.
type retryPolicy struct {
	attempts int
	base     time.Duration
	sleep    func(time.Duration)
}

func defaultRetry() retryPolicy {
	return retryPolicy{attempts: 3, base: 100 * time.Millisecond, sleep: time.Sleep}
}

// chargeWithRetry retries only "unavailable" answers, waiting longer each time (exponential backoff with
// jitter) so a struggling gateway is not hammered. Bad credentials are never retried.
func chargeWithRetry(g Gateway, p retryPolicy, orderID string, amountCents int) (string, error) {
	var lastErr error
	for attempt := 1; attempt <= p.attempts; attempt++ {
		id, err := g.Charge(orderID, amountCents)
		if err == nil {
			return id, nil
		}
		lastErr = err
		if !errors.Is(err, errUnavailable) {
			return "", err
		}
		if attempt < p.attempts {
			logWarn("payment gateway unavailable, retry %d/%d", attempt, p.attempts-1)
			backoff := p.base << (attempt - 1)
			p.sleep(backoff + time.Duration(rand.Int63n(int64(backoff)/2+1)))
		}
	}
	return "", lastErr
}

// fakeGateway is the demo's stand-in for a payment provider, with failure modes a demo can switch on.
type fakeGateway struct {
	expectedKey atomic.Value // string
	mode        atomic.Value // string: ok | unavailable
	counter     atomic.Int64
}

func newFakeGateway(expectedKey string) *fakeGateway {
	f := &fakeGateway{}
	f.expectedKey.Store(expectedKey)
	f.mode.Store("ok")
	return f
}

func (f *fakeGateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer "+f.expectedKey.Load().(string) {
		http.Error(w, `{"error":"invalid api key"}`, http.StatusUnauthorized)
		return
	}
	if f.mode.Load().(string) == "unavailable" {
		http.Error(w, `{"error":"overloaded"}`, http.StatusServiceUnavailable)
		return
	}
	time.Sleep(15 * time.Millisecond)
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"chargeId":"ch_%d"}`, f.counter.Add(1))
}
