package controller

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"pentagi/pkg/database"
	"pentagi/pkg/graph/subscriptions"
	"pentagi/pkg/providers/provider"

	"github.com/stretchr/testify/require"
)

// fakeFlowJobStore is an in-memory database.Querier limited to what the
// lifecycle-job code touches. It mirrors the parts of the real schema the tests
// depend on: the partial unique index on (flow_id, kind) over active jobs, the
// previous attempt count carried by a claimed row, and the segments written on
// every step.
type fakeFlowJobStore struct {
	database.Querier

	mx    sync.Mutex
	flows map[int64]database.Flow
	jobs  map[int64]database.FlowJob
	// active mirrors flow_jobs_active_uniq: one queued/running job per flow+kind.
	active map[string]int64

	nextFlowID int64
	nextJobID  int64

	containers    map[int64][]database.Container
	progress      []database.UpdateFlowJobProgressParams
	statusUpdates []database.FlowStatus

	// createFlowWait is the injected fault for the "slow database" case.
	createFlowWait func() error
	// latency adds a round-trip cost to the calls on the request paths, so the
	// acceptance-latency baseline is measured against a database that is not free.
	latency time.Duration
}

// slow applies the injected round-trip latency, if any.
func (s *fakeFlowJobStore) slow() {
	if s.latency > 0 {
		time.Sleep(s.latency)
	}
}

func newFakeFlowJobStore() *fakeFlowJobStore {
	return &fakeFlowJobStore{
		flows:      map[int64]database.Flow{},
		jobs:       map[int64]database.FlowJob{},
		active:     map[string]int64{},
		containers: map[int64][]database.Container{},
	}
}

func (s *fakeFlowJobStore) CreateFlowWithJob(ctx context.Context, arg database.CreateFlowWithJobParams) (database.CreateFlowWithJobRow, error) {
	flow, err := s.CreateFlow(ctx, database.CreateFlowParams{UserID: arg.UserID, ModelProviderName: arg.ModelProviderName, ModelProviderType: arg.ModelProviderType, Status: database.FlowStatusCreated})
	if err != nil {
		return database.CreateFlowWithJobRow{}, err
	}
	_, err = s.CreateFlowJob(ctx, database.CreateFlowJobParams{FlowID: flow.ID, UserID: arg.UserID, Kind: FlowJobKindCreate, Payload: arg.Payload, CorrelationID: arg.CorrelationID, MaxAttempts: arg.MaxAttempts})
	return database.CreateFlowWithJobRow{ID: flow.ID}, err
}

func jobActiveKey(flowID int64, kind string) string {
	return fmt.Sprintf("%d|%s", flowID, kind)
}

func (s *fakeFlowJobStore) CreateFlow(_ context.Context, arg database.CreateFlowParams) (database.Flow, error) {
	s.slow()

	if s.createFlowWait != nil {
		if err := s.createFlowWait(); err != nil {
			return database.Flow{}, err
		}
	}

	s.mx.Lock()
	defer s.mx.Unlock()

	s.nextFlowID++
	flow := database.Flow{
		ID:                s.nextFlowID,
		Status:            arg.Status,
		Title:             arg.Title,
		ModelProviderName: arg.ModelProviderName,
		ModelProviderType: arg.ModelProviderType,
		UserID:            arg.UserID,
	}
	s.flows[flow.ID] = flow

	return flow, nil
}

func (s *fakeFlowJobStore) GetFlow(_ context.Context, id int64) (database.Flow, error) {
	s.slow()

	s.mx.Lock()
	defer s.mx.Unlock()

	flow, ok := s.flows[id]
	if !ok {
		return database.Flow{}, sql.ErrNoRows
	}

	return flow, nil
}

func (s *fakeFlowJobStore) GetActiveFlowJob(_ context.Context, arg database.GetActiveFlowJobParams) (database.FlowJob, error) {
	s.slow()

	s.mx.Lock()
	defer s.mx.Unlock()
	id, ok := s.active[jobActiveKey(arg.FlowID, arg.Kind)]
	if !ok {
		return database.FlowJob{}, sql.ErrNoRows
	}
	return s.jobs[id], nil
}

func (s *fakeFlowJobStore) GetFlowJob(_ context.Context, id int64) (database.FlowJob, error) {
	s.slow()

	s.mx.Lock()
	defer s.mx.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return database.FlowJob{}, sql.ErrNoRows
	}

	return job, nil
}

func (s *fakeFlowJobStore) DeleteFlowDocuments(context.Context, sql.NullString) error {
	return nil
}

func (s *fakeFlowJobStore) DeleteFlow(_ context.Context, id int64) (database.Flow, error) {
	s.slow()

	s.mx.Lock()
	defer s.mx.Unlock()

	flow := s.flows[id]
	delete(s.flows, id)

	return flow, nil
}

func (s *fakeFlowJobStore) UpdateFlowStatus(_ context.Context, arg database.UpdateFlowStatusParams) (database.Flow, error) {
	s.slow()

	s.mx.Lock()
	defer s.mx.Unlock()

	flow, ok := s.flows[arg.ID]
	if !ok {
		return database.Flow{}, sql.ErrNoRows
	}

	flow.Status = arg.Status
	s.flows[arg.ID] = flow
	s.statusUpdates = append(s.statusUpdates, arg.Status)

	return flow, nil
}

func (s *fakeFlowJobStore) GetFlowContainers(context.Context, int64) ([]database.Container, error) {
	return nil, nil
}

func (s *fakeFlowJobStore) CreateFlowJob(_ context.Context, arg database.CreateFlowJobParams) (database.FlowJob, error) {
	s.slow()

	s.mx.Lock()
	defer s.mx.Unlock()

	key := jobActiveKey(arg.FlowID, arg.Kind)
	if existing, ok := s.active[key]; ok {
		return database.FlowJob{}, fmt.Errorf("active job %d already exists for %s", existing, key)
	}

	s.nextJobID++
	job := database.FlowJob{
		ID:            s.nextJobID,
		FlowID:        arg.FlowID,
		UserID:        arg.UserID,
		Kind:          arg.Kind,
		Status:        FlowJobStatusQueued,
		Step:          "queued",
		MaxAttempts:   arg.MaxAttempts,
		CorrelationID: arg.CorrelationID,
		Payload:       arg.Payload,
		Segments:      json.RawMessage("[]"),
		CreatedAt:     time.Now(),
	}
	s.jobs[job.ID] = job
	s.active[key] = job.ID

	return job, nil
}

func (s *fakeFlowJobStore) ClaimFlowJob(_ context.Context, id int64) (database.FlowJob, error) {
	s.slow()

	s.mx.Lock()
	defer s.mx.Unlock()

	job, ok := s.jobs[id]
	if !ok {
		return database.FlowJob{}, sql.ErrNoRows
	}

	if job.Status != FlowJobStatusQueued {
		return database.FlowJob{}, fmt.Errorf("job %d is not claimable (%s)", id, job.Status)
	}

	job.Status = FlowJobStatusRunning
	job.Attempts++
	s.jobs[id] = job

	return job, nil
}

func (s *fakeFlowJobStore) UpdateFlowJobProgress(_ context.Context, arg database.UpdateFlowJobProgressParams) (database.FlowJob, error) {
	s.mx.Lock()
	defer s.mx.Unlock()

	job, ok := s.jobs[arg.ID]
	if !ok {
		return database.FlowJob{}, sql.ErrNoRows
	}

	job.Step = arg.Step
	job.Segments = arg.Segments
	s.jobs[arg.ID] = job
	s.progress = append(s.progress, arg)

	return job, nil
}

func (s *fakeFlowJobStore) RequeueFlowJob(_ context.Context, arg database.RequeueFlowJobParams) (database.FlowJob, error) {
	s.mx.Lock()
	defer s.mx.Unlock()

	job := s.jobs[arg.ID]
	job.Status = FlowJobStatusQueued
	job.Step = arg.Step
	job.Error = arg.Error
	job.Segments = arg.Segments
	s.jobs[arg.ID] = job

	return job, nil
}

func (s *fakeFlowJobStore) CompleteFlowJob(_ context.Context, arg database.CompleteFlowJobParams) (database.FlowJob, error) {
	s.mx.Lock()
	defer s.mx.Unlock()

	job := s.jobs[arg.ID]
	job.Status = FlowJobStatusSucceeded
	job.Step = "done"
	job.Segments = arg.Segments
	s.jobs[arg.ID] = job
	delete(s.active, jobActiveKey(job.FlowID, job.Kind))

	return job, nil
}

func (s *fakeFlowJobStore) FailFlowJob(_ context.Context, arg database.FailFlowJobParams) (database.FlowJob, error) {
	s.mx.Lock()
	defer s.mx.Unlock()

	job := s.jobs[arg.ID]
	job.Status = FlowJobStatusFailed
	job.Step = "failed"
	job.Error = arg.Error
	job.Segments = arg.Segments
	s.jobs[arg.ID] = job
	delete(s.active, jobActiveKey(job.FlowID, job.Kind))

	return job, nil
}

func (s *fakeFlowJobStore) RecoverInterruptedFlowJobs(context.Context) ([]database.FlowJob, error) {
	s.mx.Lock()
	defer s.mx.Unlock()

	var recovered []database.FlowJob
	for id, job := range s.jobs {
		if job.Status != FlowJobStatusRunning {
			continue
		}

		job.Status = FlowJobStatusQueued
		job.Step = "recovered"
		s.jobs[id] = job
		recovered = append(recovered, job)
	}

	return recovered, nil
}

func (s *fakeFlowJobStore) ListPendingFlowJobs(_ context.Context, limit int64) ([]database.FlowJob, error) {
	s.mx.Lock()
	defer s.mx.Unlock()

	var pending []database.FlowJob
	for _, job := range s.jobs {
		if job.Status == FlowJobStatusQueued {
			pending = append(pending, job)
		}
	}

	if int64(len(pending)) > limit {
		pending = pending[:limit]
	}

	return pending, nil
}

func (s *fakeFlowJobStore) GetLatestFlowJob(_ context.Context, flowID int64) (database.FlowJob, error) {
	s.mx.Lock()
	defer s.mx.Unlock()

	var latest database.FlowJob
	var found bool
	for _, job := range s.jobs {
		if job.FlowID == flowID && (!found || job.ID > latest.ID) {
			latest, found = job, true
		}
	}

	if !found {
		return database.FlowJob{}, sql.ErrNoRows
	}

	return latest, nil
}

func (s *fakeFlowJobStore) job(id int64) database.FlowJob {
	s.mx.Lock()
	defer s.mx.Unlock()

	return s.jobs[id]
}

func (s *fakeFlowJobStore) flowStatus(id int64) database.FlowStatus {
	s.mx.Lock()
	defer s.mx.Unlock()

	return s.flows[id].Status
}

type jobTestPublisher struct {
	subscriptions.FlowPublisher

	mx      sync.Mutex
	updated int
}

func (p *jobTestPublisher) FlowUpdated(context.Context, database.Flow, []database.Container) {
	p.mx.Lock()
	defer p.mx.Unlock()

	p.updated++
}

func (p *jobTestPublisher) FlowDeleted(context.Context, database.Flow, []database.Container) {}

func (p *jobTestPublisher) updateCount() int {
	p.mx.Lock()
	defer p.mx.Unlock()

	return p.updated
}

type jobTestSubscriptions struct {
	subscriptions.SubscriptionsController

	publisher *jobTestPublisher
}

func (c *jobTestSubscriptions) NewFlowPublisher(int64, int64) subscriptions.FlowPublisher {
	return c.publisher
}

func newJobTestController(store *fakeFlowJobStore) (*flowController, *jobTestPublisher) {
	publisher := &jobTestPublisher{}
	fc := &flowController{
		db:        store,
		mx:        &sync.Mutex{},
		flows:     map[int64]FlowWorker{},
		subs:      &jobTestSubscriptions{publisher: publisher},
		recentSub: map[string]recentFlowCreate{},
	}
	fc.jobs = newFlowJobRunner(fc)

	return fc, publisher
}

func TestLifecycleRecorderRecordsSegmentsAndPublishesProgress(t *testing.T) {
	store := newFakeFlowJobStore()
	flow, err := createFlowRow(context.Background(), store, 3, provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek)
	require.NoError(t, err)

	job, err := store.CreateFlowJob(context.Background(), database.CreateFlowJobParams{
		FlowID:        flow.ID,
		UserID:        3,
		Kind:          FlowJobKindCreate,
		CorrelationID: "create-test",
		MaxAttempts:   flowJobMaxAttempts,
	})
	require.NoError(t, err)

	claimed, err := store.ClaimFlowJob(context.Background(), job.ID)
	require.NoError(t, err)

	rec := newLifecycleRecorder(store, claimed)

	// The step label is persisted *before* the work runs, so a step that is still
	// running is visible from the API.
	require.NoError(t, rec.Step(context.Background(), "provider", "probing_provider", func(context.Context) error {
		require.Equal(t, "probing_provider", store.job(job.ID).Step)

		return nil
	}))
	rec.Mark(context.Background(), "docker")
	rec.Succeed(context.Background())

	final := store.job(job.ID)
	require.Equal(t, FlowJobStatusSucceeded, final.Status)

	var segments []flowJobSegment
	require.NoError(t, json.Unmarshal(final.Segments, &segments))
	require.Len(t, segments, 2)
	require.Equal(t, "provider", segments[0].Name)
	require.Equal(t, "docker", segments[1].Name)
	require.NotEmpty(t, store.progress)
}

func TestLifecycleJobRunnerRetriesThenSucceeds(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, _ := newJobTestController(store)

	attempts := 0
	fc.jobs.executors = map[string]flowJobExecutor{
		FlowJobKindCreate: func(context.Context, database.FlowJob, *lifecycleRecorder) error {
			attempts++
			if attempts < 3 {
				return errors.New("model service unavailable")
			}

			return nil
		},
	}

	flow, err := createFlowRow(context.Background(), store, 1, provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek)
	require.NoError(t, err)

	job, err := store.CreateFlowJob(context.Background(), database.CreateFlowJobParams{
		FlowID:        flow.ID,
		UserID:        1,
		Kind:          FlowJobKindCreate,
		CorrelationID: "create-retry",
		MaxAttempts:   flowJobMaxAttempts,
	})
	require.NoError(t, err)

	ctx := context.Background()

	// First attempt: the failure is recorded and the job goes back to the queue
	// with a durable reason, not lost.
	fc.jobs.execute(ctx, job.ID)
	afterFirst := store.job(job.ID)
	require.Equal(t, FlowJobStatusQueued, afterFirst.Status)
	require.EqualValues(t, 1, afterFirst.Attempts)
	require.Contains(t, afterFirst.Error.String, "model service unavailable")

	fc.jobs.execute(ctx, job.ID)
	require.Equal(t, FlowJobStatusQueued, store.job(job.ID).Status)

	fc.jobs.execute(ctx, job.ID)
	require.Equal(t, FlowJobStatusSucceeded, store.job(job.ID).Status)
	require.Equal(t, 3, attempts)
}

func TestLifecycleJobFailsAfterMaxAttemptsAndMarksFlowFailed(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, publisher := newJobTestController(store)

	failure := errors.New("docker daemon is not responding")
	fc.jobs.executors = map[string]flowJobExecutor{
		FlowJobKindCreate: func(context.Context, database.FlowJob, *lifecycleRecorder) error {
			return failure
		},
	}

	flow, err := createFlowRow(context.Background(), store, 1, provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek)
	require.NoError(t, err)

	job, err := store.CreateFlowJob(context.Background(), database.CreateFlowJobParams{
		FlowID:        flow.ID,
		UserID:        1,
		Kind:          FlowJobKindCreate,
		CorrelationID: "create-fail",
		MaxAttempts:   2,
	})
	require.NoError(t, err)

	ctx := context.Background()
	fc.jobs.execute(ctx, job.ID)
	fc.jobs.execute(ctx, job.ID)

	final := store.job(job.ID)
	require.Equal(t, FlowJobStatusFailed, final.Status)
	require.Contains(t, final.Error.String, "docker daemon")

	// The flow is left visible and marked failed: the user is told why the task
	// never started instead of seeing the row disappear.
	require.Equal(t, database.FlowStatusFailed, store.flowStatus(flow.ID))
	require.Equal(t, 1, publisher.updateCount())
	_, err = fc.GetFlow(ctx, flow.ID)
	require.ErrorIs(t, err, ErrFlowNotFound)

	// The job slot is free again, so the flow can be retried.
	_, err = store.CreateFlowJob(ctx, database.CreateFlowJobParams{
		FlowID:        flow.ID,
		UserID:        1,
		Kind:          FlowJobKindCreate,
		CorrelationID: "create-retry-2",
		MaxAttempts:   flowJobMaxAttempts,
	})
	require.NoError(t, err)
}

func TestFlowJobRunnerRecoversInterruptedJobs(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, _ := newJobTestController(store)

	executed := make(chan int64, 1)

	flow, err := createFlowRow(context.Background(), store, 1, provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek)
	require.NoError(t, err)

	job, err := store.CreateFlowJob(context.Background(), database.CreateFlowJobParams{
		FlowID:        flow.ID,
		UserID:        1,
		Kind:          FlowJobKindCreate,
		CorrelationID: "create-interrupted",
		MaxAttempts:   flowJobMaxAttempts,
	})
	require.NoError(t, err)

	// A job that the previous process left running.
	_, err = store.ClaimFlowJob(context.Background(), job.ID)
	require.NoError(t, err)

	ctx := context.Background()
	fc.jobs.Start(ctx)

	// Injected after Start so the recovered row is driven by a controllable
	// executor instead of a real provider probe.
	fc.jobs.executors = map[string]flowJobExecutor{
		FlowJobKindCreate: func(_ context.Context, job database.FlowJob, _ *lifecycleRecorder) error {
			executed <- job.ID

			return nil
		},
	}

	require.Equal(t, FlowJobStatusQueued, store.job(job.ID).Status)

	// Whichever way the poller would have found it, the recovered row is runnable.
	fc.jobs.drainQueued(ctx)

	select {
	case id := <-executed:
		require.Equal(t, job.ID, id)
	case <-time.After(3 * time.Second):
		t.Fatal("the recovered job never ran")
	}

	require.Eventually(t, func() bool {
		return store.job(job.ID).Status == FlowJobStatusSucceeded
	}, 3*time.Second, 10*time.Millisecond)
}

func TestCreateFlowQueuesJobAndReturnsImmediately(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, _ := newJobTestController(store)

	executed := make(chan int64, 1)
	fc.jobs.executors = map[string]flowJobExecutor{
		FlowJobKindCreate: func(_ context.Context, job database.FlowJob, _ *lifecycleRecorder) error {
			executed <- job.ID

			return nil
		},
	}

	ctx := context.Background()
	flowID, err := fc.CreateFlow(ctx, 9, "scan 10.0.0.0/24", provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, nil)
	require.NoError(t, err)
	require.NotZero(t, flowID)

	// The row the caller can already work with exists, still marked as
	// initializing, and the expensive part has not run inside the request.
	require.Equal(t, database.FlowStatusCreated, store.flowStatus(flowID))

	latest, err := store.GetLatestFlowJob(ctx, flowID)
	require.NoError(t, err)
	require.Equal(t, FlowJobKindCreate, latest.Kind)
	require.Equal(t, FlowJobStatusQueued, latest.Status)

	payload, err := decodeFlowJobPayload(latest.Payload)
	require.NoError(t, err)
	require.Equal(t, "scan 10.0.0.0/24", payload.Input)
}

func TestCreateFlowDuplicateSubmissionReusesTheFlowAlreadyStarting(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, _ := newJobTestController(store)
	fc.jobs.executors = map[string]flowJobExecutor{}

	ctx := context.Background()
	first, err := fc.CreateFlow(ctx, 9, "same task text", provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, nil)
	require.NoError(t, err)

	second, err := fc.CreateFlow(ctx, 9, "same task text", provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek, nil, nil)
	require.NoError(t, err)
	require.Equal(t, first, second)

	require.Len(t, store.jobs, 1, "a duplicate submission must not create a second flow")
}

func TestCreateLifecycleJobReusesAConcurrentDuplicate(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, _ := newJobTestController(store)

	flow, err := createFlowRow(context.Background(), store, 1, provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek)
	require.NoError(t, err)

	_, err = fc.createLifecycleJob(context.Background(), flow.ID, FlowJobKindFinish, flowJobPayload{})
	require.NoError(t, err)

	job, err := fc.createLifecycleJob(context.Background(), flow.ID, FlowJobKindFinish, flowJobPayload{})
	require.NoError(t, err)
	require.EqualValues(t, 1, job.ID)
	require.Len(t, store.jobs, 1)
}

func TestFinishFlowReturnsBeforeTheCleanupRuns(t *testing.T) {
	store := newFakeFlowJobStore()
	fc, _ := newJobTestController(store)

	flow, err := createFlowRow(context.Background(), store, 1, provider.DefaultProviderNameDeepSeek, provider.ProviderDeepSeek)
	require.NoError(t, err)

	released := make(chan struct{})

	slow := &waitingFlowWorker{id: flow.ID, wait: func() error {
		<-released

		return nil
	}}
	fc.mx.Lock()
	fc.flows[flow.ID] = slow
	fc.mx.Unlock()

	fc.jobs.executors = map[string]flowJobExecutor{
		FlowJobKindFinish: fc.jobs.executeFinish,
	}

	ctx := context.Background()
	require.NoError(t, fc.FinishFlow(ctx, flow.ID))

	// The request came back while the worker is still shutting down; the flow is
	// still registered and the job says what is happening.
	require.Equal(t, FlowJobStatusQueued, store.job(1).Status)

	// Only now may the shutdown finish, and the cleanup runs on the runner.
	close(released)
	fc.jobs.execute(ctx, 1)

	require.Equal(t, FlowJobStatusSucceeded, store.job(1).Status)
	_, err = fc.GetFlow(ctx, flow.ID)
	require.ErrorIs(t, err, ErrFlowNotFound)
}
