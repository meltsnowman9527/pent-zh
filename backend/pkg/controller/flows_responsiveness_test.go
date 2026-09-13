package controller

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"pentagi/pkg/database"
	"pentagi/pkg/providers/provider"

	"github.com/stretchr/testify/require"
)

type waitingFlowWorker struct {
	FlowWorker
	id   int64
	wait func() error
}

func (f *waitingFlowWorker) GetFlowID() int64                     { return f.id }
func (f *waitingFlowWorker) Stop(context.Context) error           { return f.wait() }
func (f *waitingFlowWorker) Finish(context.Context) error         { return f.wait() }
func (f *waitingFlowWorker) Rename(context.Context, string) error { return f.wait() }

type waitingCreateQuerier struct {
	database.Querier
	wait func() error
}

func (q *waitingCreateQuerier) CreateFlow(context.Context, database.CreateFlowParams) (database.Flow, error) {
	return database.Flow{}, q.wait()
}

// A slow model/database/worker operation must not make the task list and
// unrelated task lookup wait for the entire lifecycle operation to finish.
func TestFlowRegistryResponsiveDuringSlowMutation(t *testing.T) {
	for _, operation := range []string{"create", "assistant", "stop", "finish", "rename"} {
		t.Run(operation, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			wait := func() error { close(entered); <-release; return nil }
			fc := &flowController{
				mx: &sync.Mutex{},
				flows: map[int64]FlowWorker{
					1: &waitingFlowWorker{id: 1, wait: wait},
					2: &waitingFlowWorker{id: 2},
				},
				db: &waitingCreateQuerier{wait: func() error {
					_ = wait()
					return errors.New("controlled create failure")
				}},
			}
			ctx := context.Background()
			done := make(chan error, 1)
			go func() {
				switch operation {
				case "create":
					_, err := fc.CreateFlow(ctx, 1, "test", provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, nil)
					done <- err
				case "assistant":
					_, err := fc.CreateAssistant(ctx, 1, 0, "test", false, provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, nil)
					done <- err
				case "stop":
					done <- fc.StopFlow(ctx, 1)
				case "finish":
					done <- fc.FinishFlow(ctx, 1)
				case "rename":
					done <- fc.RenameFlow(ctx, 1, "renamed")
				}
			}()
			select {
			case <-entered:
			case <-time.After(2 * time.Second):
				t.Fatal("mutation did not reach the controlled wait")
			}
			readDone := make(chan error, 1)
			go func() {
				flow, err := fc.GetFlow(ctx, 2)
				if err != nil {
					readDone <- err
					return
				}
				if flow.GetFlowID() != 2 || len(fc.ListFlows(ctx)) != 2 {
					readDone <- errors.New("unexpected registry contents")
					return
				}
				readDone <- nil
			}()
			select {
			case err := <-readDone:
				require.NoError(t, err)
			case <-time.After(2 * time.Second):
				t.Fatal("task reads blocked behind a slow mutation")
			}
			unblock()
			if operation == "create" || operation == "assistant" {
				require.Error(t, <-done)
			} else {
				require.NoError(t, <-done)
			}
			_, err := fc.GetFlow(ctx, 1)
			if operation == "finish" {
				require.ErrorIs(t, err, ErrFlowNotFound)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestFinishFailureKeepsFlowAvailableForRetry(t *testing.T) {
	failure := errors.New("worker shutdown failed")
	fw := &waitingFlowWorker{id: 1, wait: func() error { return failure }}
	fc := &flowController{mx: &sync.Mutex{}, flows: map[int64]FlowWorker{1: fw}}
	require.ErrorIs(t, fc.FinishFlow(context.Background(), 1), failure)
	actual, err := fc.GetFlow(context.Background(), 1)
	require.NoError(t, err)
	require.Same(t, fw, actual)
	fw.wait = func() error { return nil }
	require.NoError(t, fc.FinishFlow(context.Background(), 1))
	_, err = fc.GetFlow(context.Background(), 1)
	require.ErrorIs(t, err, ErrFlowNotFound)
}

func TestConcurrentFinishOnlyShutsDownWorkerOnce(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	fw := &waitingFlowWorker{id: 1, wait: func() error { close(entered); <-release; return nil }}
	fc := &flowController{mx: &sync.Mutex{}, flows: map[int64]FlowWorker{1: fw}}
	done := make(chan error, 2)
	go func() { done <- fc.FinishFlow(context.Background(), 1) }()
	<-entered
	go func() { done <- fc.FinishFlow(context.Background(), 1) }()
	once.Do(func() { close(release) })
	first, second := <-done, <-done
	if first != nil {
		first, second = second, first
	}
	require.NoError(t, first)
	require.ErrorIs(t, second, ErrFlowNotFound)
}
