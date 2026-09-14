package controller

import (
	"context"
	"fmt"
	"math"
	"sort"
	"sync"
	"testing"
	"time"

	"pentagi/pkg/database"
	"pentagi/pkg/providers/provider"

	"github.com/stretchr/testify/require"
)

// The P0 acceptance criterion asks for the *request* half of the flow lifecycle
// (not the background work) to stay under two seconds locally, so that a slow
// model or a slow docker preparation cannot make the API feel broken. The
// numbers these tests log are the baseline that target is frozen against.
const (
	flowAcceptanceBudget     = 2 * time.Second
	latencyBudgetIterations  = 120
	latencyBudgetDBRoundTrip = 2 * time.Millisecond
)

func durationPercentile(sorted []time.Duration, percentile float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}

	index := int(math.Ceil(percentile/100*float64(len(sorted)))) - 1
	index = min(max(index, 0), len(sorted)-1)

	return sorted[index]
}

// opLatencies collects one operation's request-time durations.
type opLatencies struct {
	samples []time.Duration
}

func (o *opLatencies) add(spent time.Duration) {
	o.samples = append(o.samples, spent)
}

// report logs the distribution and returns p95, which is what the budget is
// checked against.
func (o *opLatencies) report(t *testing.T, label string) time.Duration {
	t.Helper()

	sorted := append([]time.Duration(nil), o.samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	t.Logf("acceptance latency %s: n=%d p50=%s p95=%s p99=%s max=%s",
		label, len(sorted),
		durationPercentile(sorted, 50),
		durationPercentile(sorted, 95),
		durationPercentile(sorted, 99),
		sorted[len(sorted)-1],
	)

	return durationPercentile(sorted, 95)
}

// slowInitialization puts a create job in flight that holds the lifecycle lock for
// as long as the real one does while it probes the provider and prepares
// containers — the injected fault for the "slow model / slow docker" case.
func slowInitialization(t *testing.T, fc *flowController, store *fakeFlowJobStore) (release func()) {
	t.Helper()

	entered := make(chan struct{})
	done := make(chan struct{})
	var once sync.Once

	release = func() {
		once.Do(func() { close(done) })
	}

	t.Cleanup(release)

	fc.jobs.executors[FlowJobKindCreate] = func(context.Context, database.FlowJob, *lifecycleRecorder) error {
		fc.lifecycleMX.Lock()
		defer fc.lifecycleMX.Unlock()

		close(entered)
		<-done

		return nil
	}

	job, err := store.CreateFlowJob(context.Background(), database.CreateFlowJobParams{
		FlowID:        1,
		UserID:        1,
		Kind:          FlowJobKindCreate,
		CorrelationID: "slow-init",
		MaxAttempts:   flowJobMaxAttempts,
	})
	require.NoError(t, err)

	go fc.jobs.execute(context.Background(), job.ID)

	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the injected slow initialization did not start")
	}

	return release
}

func newLatencyTestController(t *testing.T) (*flowController, *fakeFlowJobStore) {
	t.Helper()

	store := newFakeFlowJobStore()
	store.latency = latencyBudgetDBRoundTrip
	store.flows[1] = database.Flow{ID: 1, UserID: 1, Status: database.FlowStatusRunning}
	// Keep the pre-seeded row from colliding with the next created flow.
	store.nextFlowID = 1

	fc, _ := newJobTestController(store)
	fc.flows[1] = &waitingFlowWorker{id: 1, wait: func() error { return nil }}

	return fc, store
}

// The measured operations are the ones a user waits for: reading the list,
// reading one flow, and the acceptance half of create / finish / delete. Every
// one of them must stay fast while a slow initialization is in flight.
func TestFlowAcceptanceLatencyUnderSlowInitialization(t *testing.T) {
	fc, store := newLatencyTestController(t)
	release := slowInitialization(t, fc, store)

	reads, creates := &opLatencies{}, &opLatencies{}
	finishes, deletes := &opLatencies{}, &opLatencies{}
	ctx := context.Background()

	for i := range latencyBudgetIterations {
		start := time.Now()
		flow, err := fc.GetFlow(ctx, 1)
		require.NoError(t, err)
		require.Equal(t, int64(1), flow.GetFlowID())
		reads.add(time.Since(start))

		start = time.Now()
		require.Len(t, fc.ListFlows(ctx), 1)
		reads.add(time.Since(start))

		start = time.Now()
		// A unique task text on purpose: an identical submission inside the dedupe
		// window is answered from memory and would not measure the insert.
		flowID, err := fc.CreateFlow(ctx, 1, fmt.Sprintf("scan target %d", i),
			provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, nil)
		creates.add(time.Since(start))
		require.NoError(t, err)
		require.NotZero(t, flowID)

		start = time.Now()
		require.NoError(t, fc.FinishFlow(ctx, flowID))
		finishes.add(time.Since(start))

		start = time.Now()
		require.NoError(t, fc.DeleteFlow(ctx, flowID))
		deletes.add(time.Since(start))
	}

	release()

	for label, p95 := range map[string]time.Duration{
		"create": creates.report(t, "create acceptance"),
		"delete": deletes.report(t, "delete acceptance"),
		"finish": finishes.report(t, "finish acceptance"),
		"reads":  reads.report(t, "GetFlow + ListFlows"),
	} {
		require.LessOrEqualf(t, p95, flowAcceptanceBudget,
			"%s p95 of %s exceeds the %s request-acceptance budget", label, p95, flowAcceptanceBudget)
	}
}

// Known limitation, pinned so it cannot drift silently: the lifecycle lock is
// held across the slow half of an initialization, so a stop request for *another*
// flow waits for it to finish. Moving the provider/docker work out of the lock
// (or turning stop into a queued job) is the fix; until then this test documents
// the coupling and the single-flight runner behind it.
func TestSlowInitializationDelaysOtherLifecycleRequests(t *testing.T) {
	fc, store := newLatencyTestController(t)
	// The flow being stopped needs a registry worker of its own.
	fc.flows[2] = &waitingFlowWorker{id: 2, wait: func() error { return nil }}
	store.flows[2] = database.Flow{ID: 2, UserID: 1, Status: database.FlowStatusRunning}

	release := slowInitialization(t, fc, store)

	stopped := make(chan error, 1)

	go func() { stopped <- fc.StopFlow(context.Background(), 2) }()

	select {
	case err := <-stopped:
		t.Fatalf("stop of another flow completed (%v) while the initialization held the lifecycle lock", err)
	case <-time.After(200 * time.Millisecond):
		t.Log("stop of another flow waits for the in-flight initialization (known limitation)")
	}

	release()

	select {
	case err := <-stopped:
		require.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("stop did not complete after the initialization was released")
	}
}

// The runner's loop executes one job at a time, so a slow initialization delays
// the next flow's lifecycle job even when the two flows are unrelated. Same known
// limitation as above, from the queue's point of view.
func TestSingleFlightRunnerSerializesLifecycleJobs(t *testing.T) {
	fc, store := newLatencyTestController(t)
	store.flows[2] = database.Flow{ID: 2, UserID: 1, Status: database.FlowStatusRunning}

	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }

	defer unblock()
	defer fc.jobs.Stop()

	started := make(chan int64, 2)

	fc.jobs.Start(context.Background())
	// Set after Start, which installs the real executors.
	fc.jobs.executors[FlowJobKindCreate] = func(_ context.Context, job database.FlowJob, _ *lifecycleRecorder) error {
		started <- job.FlowID

		if job.FlowID == 1 {
			close(entered)
			<-release
		}

		return nil
	}

	first, err := store.CreateFlowJob(context.Background(), database.CreateFlowJobParams{
		FlowID: 1, UserID: 1, Kind: FlowJobKindCreate, CorrelationID: "first", MaxAttempts: flowJobMaxAttempts,
	})
	require.NoError(t, err)
	second, err := store.CreateFlowJob(context.Background(), database.CreateFlowJobParams{
		FlowID: 2, UserID: 1, Kind: FlowJobKindCreate, CorrelationID: "second", MaxAttempts: flowJobMaxAttempts,
	})
	require.NoError(t, err)

	fc.jobs.enqueue(first.ID)

	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the first job did not start")
	}

	fc.jobs.enqueue(second.ID)

	select {
	case flowID := <-started:
		if flowID != 1 {
			t.Fatalf("unexpected job order, flow %d started first", flowID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no lifecycle job started")
	}

	select {
	case flowID := <-started:
		t.Fatalf("flow %d started while flow 1 was still initializing (single-flight runner)", flowID)
	case <-time.After(100 * time.Millisecond):
		t.Log("the second flow's lifecycle job waits for the first (known limitation)")
	}

	unblock()

	select {
	case flowID := <-started:
		require.Equal(t, int64(2), flowID)
	case <-time.After(5 * time.Second):
		t.Fatal("the second job never started after the first was released")
	}
}
