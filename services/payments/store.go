package main

import "sync"

// Result is what a finished charge answered, kept so the same checkout can be replayed safely.
type Result struct {
	ChargeID    string `json:"chargeId"`
	AmountCents int    `json:"amountCents"`
}

// Store remembers results by idempotency key.
type Store struct {
	mu      sync.Mutex
	results map[string]Result
}

func NewStore() *Store {
	return &Store{results: make(map[string]Result)}
}

func (s *Store) Get(key string) (Result, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.results[key]
	return r, ok
}

func (s *Store) Put(key string, r Result) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.results[key] = r
}
