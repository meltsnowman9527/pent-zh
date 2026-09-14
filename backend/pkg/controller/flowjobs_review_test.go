package controller

import (
	"context"
	"errors"
	"github.com/stretchr/testify/require"
	"pentagi/pkg/database"
	"pentagi/pkg/providers/provider"
	"strings"
	"testing"
	"time"
)

func TestFullLifecycleQueueDoesNotBlockSubmission(t *testing.T) {
	fc, _ := newJobTestController(newFakeFlowJobStore())
	defer fc.jobs.Stop()
	done := make(chan struct{})
	go func() {
		for i := int64(0); i < 1000; i++ {
			fc.jobs.enqueue(i)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("a full queue blocked its producer")
	}
}

func TestCreateAcceptedDuringSlowLifecycle(t *testing.T) {
	fc, _ := newJobTestController(newFakeFlowJobStore())
	fc.lifecycleMX.Lock()
	defer fc.lifecycleMX.Unlock()
	done := make(chan error, 1)
	go func() {
		_, err := fc.CreateFlow(context.Background(), 1, "test", provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, nil)
		done <- err
	}()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("creation blocked behind another lifecycle operation")
	}
}

func TestOversizeSubmissionDoesNotLeaveAFlow(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, _ := newJobTestController(store)
	_, err := fc.CreateFlow(context.Background(), 1, strings.Repeat("a", flowJobMaxPayloadBytes+1), provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, nil)
	require.Error(t, err)
	require.Empty(t, store.flows)
}

func TestDeletionKeepsRecordUntilCleanupSucceeds(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, _ := newJobTestController(store)
	store.flows[1] = database.Flow{ID: 1, UserID: 1, Status: database.FlowStatusRunning}
	failed := true
	fc.flows[1] = &waitingFlowWorker{id: 1, wait: func() error {
		if failed {
			return errors.New("cleanup unavailable")
		}
		return nil
	}}
	fc.jobs.executors[FlowJobKindDelete] = fc.jobs.executeDelete
	require.NoError(t, fc.DeleteFlow(context.Background(), 1))
	require.Contains(t, store.flows, int64(1))
	fc.jobs.execute(context.Background(), 1)
	require.Contains(t, store.flows, int64(1), "failed cleanup must not hide the record")
	failed = false
	fc.jobs.execute(context.Background(), 1)
	require.NotContains(t, store.flows, int64(1))
	require.Equal(t, FlowJobStatusSucceeded, store.job(1).Status)
}

func TestRunningLifecycleJobCannotBeClaimedAgain(t *testing.T) {
	store := newFakeFlowJobStore()
	job, err := store.CreateFlowJob(context.Background(), database.CreateFlowJobParams{FlowID: 1, Kind: FlowJobKindCreate})
	require.NoError(t, err)
	_, err = store.ClaimFlowJob(context.Background(), job.ID)
	require.NoError(t, err)
	_, err = store.ClaimFlowJob(context.Background(), job.ID)
	require.Error(t, err)
}
func TestCreateDeduplicationIncludesResourcesAndIgnoresFailedFlows(t *testing.T) {
    store := newFakeFlowJobStore()
    fc, _ := newJobTestController(store)
    first, err := fc.CreateFlow(context.Background(), 1, "test", provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, []database.UserResource{{Path:"first.txt"}})
    require.NoError(t, err)
    second, err := fc.CreateFlow(context.Background(), 1, "test", provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, []database.UserResource{{Path:"second.txt"}})
    require.NoError(t, err)
    require.NotEqual(t, first, second)
    _, err = store.UpdateFlowStatus(context.Background(), database.UpdateFlowStatusParams{ID:second, Status:database.FlowStatusFailed})
    require.NoError(t, err)
    third, err := fc.CreateFlow(context.Background(), 1, "test", provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, []database.UserResource{{Path:"second.txt"}})
    require.NoError(t, err)
    require.NotEqual(t, second, third)
}
