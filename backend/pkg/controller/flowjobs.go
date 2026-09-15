package controller

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"pentagi/pkg/database"
	"pentagi/pkg/providers/provider"
	"pentagi/pkg/tools"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
)

// Lifecycle job kinds. One row per operation, so a create that is still
// initializing, or a delete that is still cleaning up, is a record the UI and
// the operator can see instead of a request that appears to have done nothing.
const (
	FlowJobKindCreate = "create"
	FlowJobKindStop   = "stop"
	FlowJobKindFinish = "finish"
	FlowJobKindDelete = "delete"
)

// Lifecycle job statuses. `queued` and `running` are the only states a job can
// be picked up from; everything else is terminal and kept for the record.
const (
	FlowJobStatusQueued    = "queued"
	FlowJobStatusRunning   = "running"
	FlowJobStatusSucceeded = "succeeded"
	FlowJobStatusFailed    = "failed"
)

const (
	// A create job is retried this many times before it is declared failed.
	flowJobMaxAttempts = 3
	// Retry backoff: attempt 1 waits baseWait, attempt 2 waits 2×, and so on.
	flowJobRetryBaseWait = 3 * time.Second
	// How often the runner looks for jobs that were queued by another process
	// (or by a restart) rather than handed to it directly.
	flowJobPollInterval = 5 * time.Second
	// Upper bound on rows fetched per poll.
	flowJobDrainLimit = 32
	// Independent flows may perform lifecycle work concurrently. Ordering for a
	// single flow is preserved by the scheduler and the per-flow lifecycle lock.
	flowJobMaxConcurrency = 4
	// A duplicate create submitted inside this window is answered with the flow
	// that is already being initialized instead of starting a second one.
	flowJobSubmitWindow = 30 * time.Second
	// Jobs are small; this bounds what a caller can push into one.
	flowJobMaxPayloadBytes = 1 << 20
)

// flowJobSegment is one measured phase of a lifecycle operation. Model, database
// and docker latency land in different segments on purpose: the whole point of
// recording them is telling them apart without a profiler.
type flowJobSegment struct {
	Name string `json:"name"`
	Ms   int64  `json:"ms"`
}

// lifecycleRecorder times the phases of one lifecycle job and persists them on
// the job row. Every write is best-effort: a failing status write must never
// turn a working operation into a failed one.
type lifecycleRecorder struct {
	db            database.Querier
	jobID         int64
	flowID        int64
	correlationID string
	logger        *logrus.Entry
	started       time.Time
	last          time.Time
	segments      []flowJobSegment
}

func newLifecycleRecorder(db database.Querier, job database.FlowJob) *lifecycleRecorder {
	now := time.Now()

	return &lifecycleRecorder{
		db:            db,
		jobID:         job.ID,
		flowID:        job.FlowID,
		correlationID: job.CorrelationID,
		logger: logrus.WithFields(logrus.Fields{
			"flow_id":        job.FlowID,
			"job_id":         job.ID,
			"job_kind":       job.Kind,
			"correlation_id": job.CorrelationID,
			"attempt":        job.Attempts,
		}),
		started: now,
		last:    now,
	}
}

// Mark closes the segment that started at the previous mark (or at job start)
// and persists the step it just finished. Nil-safe so the synchronous paths can
// run without a job record.
func (r *lifecycleRecorder) Mark(ctx context.Context, name string) {
	if r == nil {
		return
	}

	now := time.Now()
	r.segments = append(r.segments, flowJobSegment{Name: name, Ms: now.Sub(r.last).Milliseconds()})
	r.last = now

	r.persist(ctx, name)

	r.logger.WithField("segment", name).
		WithField("ms", r.segments[len(r.segments)-1].Ms).
		Debug("lifecycle step finished")
}

// Step runs fn inside a segment and leaves `label` on the job row while it runs,
// so a step that is still in progress is visible from the API.
func (r *lifecycleRecorder) Step(ctx context.Context, name, label string, fn func(context.Context) error) error {
	if r != nil {
		r.persist(ctx, label)
	}

	start := time.Now()
	err := fn(ctx)

	if r != nil {
		now := time.Now()
		r.segments = append(r.segments, flowJobSegment{Name: name, Ms: now.Sub(start).Milliseconds()})
		r.last = now
		r.logger.WithField("segment", name).
			WithField("ms", r.segments[len(r.segments)-1].Ms).
			WithError(err).
			Debug("lifecycle step finished")
	}

	return err
}

func (r *lifecycleRecorder) persist(ctx context.Context, step string) {
	if _, err := r.db.UpdateFlowJobProgress(ctx, database.UpdateFlowJobProgressParams{
		ID:       r.jobID,
		Step:     step,
		Segments: r.segmentsJSON(),
	}); err != nil {
		r.logger.WithError(err).Warn("failed to record lifecycle job progress")
	}
}

func (r *lifecycleRecorder) segmentsJSON() json.RawMessage {
	if len(r.segments) == 0 {
		return json.RawMessage("[]")
	}

	blob, err := json.Marshal(r.segments)
	if err != nil {
		return json.RawMessage("[]")
	}

	return blob
}

// Succeed marks the job done and logs one line an operator can grep by
// correlation id when a user reports that "creating a task was slow".
func (r *lifecycleRecorder) Succeed(ctx context.Context) {
	if r == nil {
		return
	}

	if _, err := r.db.CompleteFlowJob(ctx, database.CompleteFlowJobParams{
		ID:       r.jobID,
		Segments: r.segmentsJSON(),
	}); err != nil {
		r.logger.WithError(err).Warn("failed to mark lifecycle job as succeeded")
	}

	r.logger.WithFields(r.summary()).Info("lifecycle job succeeded")
}

// Requeue puts the job back in the queue with the failure recorded, so the next
// attempt starts from a durable row rather than from a lost in-memory state.
func (r *lifecycleRecorder) Requeue(ctx context.Context, step string, cause error) {
	if r == nil {
		return
	}

	if _, err := r.db.RequeueFlowJob(ctx, database.RequeueFlowJobParams{
		ID:       r.jobID,
		Step:     step,
		Error:    database.StringToNullString(errorText(cause)),
		Segments: r.segmentsJSON(),
	}); err != nil {
		r.logger.WithError(err).Warn("failed to requeue lifecycle job")
	}

	r.logger.WithFields(r.summary()).WithError(cause).Warn("lifecycle job failed, will be retried")
}

// Fail records the terminal failure. The caller decides what that means for the
// flow itself; the job row always keeps the reason.
func (r *lifecycleRecorder) Fail(ctx context.Context, cause error) {
	if r == nil {
		return
	}

	if _, err := r.db.FailFlowJob(ctx, database.FailFlowJobParams{
		ID:       r.jobID,
		Error:    database.StringToNullString(errorText(cause)),
		Segments: r.segmentsJSON(),
	}); err != nil {
		r.logger.WithError(err).Warn("failed to mark lifecycle job as failed")
	}

	r.logger.WithFields(r.summary()).WithError(cause).Error("lifecycle job failed")
}

func (r *lifecycleRecorder) summary() logrus.Fields {
	fields := logrus.Fields{
		"flow_id":        r.flowID,
		"job_id":         r.jobID,
		"correlation_id": r.correlationID,
		"total_ms":       time.Since(r.started).Milliseconds(),
	}

	for _, segment := range r.segments {
		fields["ms_"+segment.Name] = segment.Ms
	}

	return fields
}

func errorText(err error) string {
	if err == nil {
		return ""
	}

	text := err.Error()
	if len(text) > 2000 {
		return text[:2000]
	}

	return text
}

// flowJobPayload carries everything the runner needs to (re)start an operation
// after a failure or a restart: the row in the database is the source of truth,
// never a process-local variable.
type flowJobPayload struct {
	Input     string                  `json:"input,omitempty"`
	Functions json.RawMessage         `json:"functions,omitempty"`
	Resources []database.UserResource `json:"resources,omitempty"`
}

func encodeFlowJobPayload(payload flowJobPayload) (json.RawMessage, error) {
	blob, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode job payload: %w", err)
	}

	if len(blob) > flowJobMaxPayloadBytes {
		return nil, fmt.Errorf("job payload of %d bytes exceeds the %d byte limit", len(blob), flowJobMaxPayloadBytes)
	}

	return blob, nil
}

func decodeFlowJobPayload(raw json.RawMessage) (flowJobPayload, error) {
	var payload flowJobPayload
	if len(raw) == 0 {
		return payload, nil
	}

	if err := json.Unmarshal(raw, &payload); err != nil {
		return payload, fmt.Errorf("failed to decode job payload: %w", err)
	}

	return payload, nil
}

func (p flowJobPayload) functions() (*tools.Functions, error) {
	functions := &tools.Functions{}
	if len(p.Functions) == 0 {
		return functions, nil
	}

	if err := json.Unmarshal(p.Functions, functions); err != nil {
		return nil, fmt.Errorf("failed to decode job functions: %w", err)
	}

	return functions, nil
}

// flowJobExecutor performs one kind of lifecycle work. `rec` is nil-safe, but
// every executor receives the real recorder for its job.
type flowJobExecutor func(ctx context.Context, job database.FlowJob, rec *lifecycleRecorder) error

// flowJobRunner executes a bounded number of independent flows concurrently.
// Jobs for the same flow stay FIFO, while a slow provider or Docker operation
// cannot head-of-line block unrelated flows.
type flowJobRunner struct {
	fc        *flowController
	executors map[string]flowJobExecutor
	queue     chan int64
	ctx       context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	workerWG  sync.WaitGroup
	startOnce sync.Once

	inFlightMX sync.Mutex
	inFlight   map[int64]struct{}
}

func newFlowJobRunner(fc *flowController) *flowJobRunner {
	ctx, cancel := context.WithCancel(context.Background())

	return &flowJobRunner{
		fc:        fc,
		executors: map[string]flowJobExecutor{},
		queue:     make(chan int64, 64),
		ctx:       ctx,
		cancel:    cancel,
		inFlight:  map[int64]struct{}{},
	}
}

// Start recovers jobs left behind by a previous process and begins draining the
// queue. Idempotent: LoadFlows runs on every start, and some deployments call it
// more than once.
func (r *flowJobRunner) Start(ctx context.Context) {
	r.startOnce.Do(func() {
		r.executors = map[string]flowJobExecutor{
			FlowJobKindCreate: r.executeCreate,
			FlowJobKindFinish: r.executeFinish,
			FlowJobKindDelete: r.executeDelete,
			FlowJobKindStop:   r.executeStop,
		}

		if recovered, err := r.fc.db.RecoverInterruptedFlowJobs(ctx); err != nil {
			logrus.WithContext(ctx).WithError(err).
				Warn("failed to recover interrupted lifecycle jobs")
		} else if len(recovered) > 0 {
			for _, job := range recovered {
				logrus.WithContext(ctx).WithFields(logrus.Fields{
					"job_id":         job.ID,
					"flow_id":        job.FlowID,
					"job_kind":       job.Kind,
					"correlation_id": job.CorrelationID,
					"attempts":       job.Attempts,
				}).Warn("resuming lifecycle job interrupted by a restart")
			}
		}

		r.wg.Add(1)

		go r.loop()
	})
}

func (r *flowJobRunner) Stop() {
	r.cancel()
	r.wg.Wait()
	r.workerWG.Wait()
}

// enqueue hands a job to the runner. The queue is bounded, so a wedged runner
// applies backpressure to the enqueuer instead of growing without limit; the
// job row is already durable either way and the poller picks it up later.
func (r *flowJobRunner) enqueue(jobID int64) {
	select {
	case r.queue <- jobID:
	case <-r.ctx.Done():
	default: // The database poller will pick it up; never block a request or the poller itself.
	}
}

func (r *flowJobRunner) loop() {
	defer r.wg.Done()

	ticker := time.NewTicker(flowJobPollInterval)
	defer ticker.Stop()
	type completedJob struct {
		flowID int64
		jobID  int64
	}
	done := make(chan completedJob, flowJobMaxConcurrency)
	pending := make(map[int64][]int64)
	active := make(map[int64]bool)
	queued := make(map[int64]struct{})
	running := 0

	startReady := func() {
		for running < flowJobMaxConcurrency {
			var flowID int64
			var jobID int64
			for candidate, jobs := range pending {
				if active[candidate] || len(jobs) == 0 {
					continue
				}
				flowID, jobID = candidate, jobs[0]
				pending[candidate] = jobs[1:]
				break
			}
			if jobID == 0 {
				return
			}

			active[flowID] = true
			running++
			r.workerWG.Add(1)
			go func(flowID, jobID int64) {
				defer r.workerWG.Done()
				r.execute(r.ctx, jobID)
				select {
				case done <- completedJob{flowID: flowID, jobID: jobID}:
				case <-r.ctx.Done():
				}
			}(flowID, jobID)
		}
	}

	schedule := func(jobID int64) {
		if _, exists := queued[jobID]; exists {
			return
		}
		job, err := r.fc.db.GetFlowJob(r.ctx, jobID)
		if err != nil || job.Status != FlowJobStatusQueued {
			return
		}
		queued[jobID] = struct{}{}
		pending[job.FlowID] = append(pending[job.FlowID], jobID)
		startReady()
	}

	for {
		select {
		case <-r.ctx.Done():
			return
		case jobID := <-r.queue:
			schedule(jobID)
		case completed := <-done:
			active[completed.flowID] = false
			running--
			// Retried jobs are enqueued by their timer and may therefore enter
			// the scheduler again after this completed attempt leaves the set.
			delete(queued, completed.jobID)
			startReady()
		case <-ticker.C:
			r.drainQueued(r.ctx)
		}
	}
}

// drainQueued picks up jobs that are queued in the database but were never handed
// to this process — a restart, or a second instance sharing the database.
func (r *flowJobRunner) drainQueued(ctx context.Context) {
	jobs, err := r.fc.db.ListPendingFlowJobs(ctx, flowJobDrainLimit)
	if err != nil {
		logrus.WithContext(ctx).WithError(err).Warn("failed to list pending lifecycle jobs")
		return
	}

	for _, job := range jobs {
		if job.Status == FlowJobStatusRunning {
			continue // already being worked on by this process
		}

		r.enqueue(job.ID)
	}
}

func (r *flowJobRunner) execute(ctx context.Context, jobID int64) {
	if !r.claim(jobID) {
		return
	}
	defer r.release(jobID)

	job, err := r.fc.db.ClaimFlowJob(ctx, jobID)
	if err != nil {
		// The row moved on (deleted with its flow, or finished elsewhere).
		logrus.WithContext(ctx).WithError(err).WithField("job_id", jobID).
			Debug("lifecycle job is no longer claimable")
		return
	}

	rec := newLifecycleRecorder(r.fc.db, job)

	executor, ok := r.executors[job.Kind]
	if !ok {
		rec.Fail(ctx, fmt.Errorf("unknown lifecycle job kind %q", job.Kind))
		return
	}

	if job.Attempts > job.MaxAttempts {
		rec.Fail(ctx, fmt.Errorf("lifecycle job exceeded %d attempts", job.MaxAttempts))
		r.onTerminalFailure(ctx, job, rec)

		return
	}

	if err := executor(ctx, job, rec); err != nil {
		retryIn := flowJobRetryWait(job.Attempts)
		if job.Attempts < job.MaxAttempts {
			rec.Requeue(ctx, "retrying", err)
			time.AfterFunc(retryIn, func() { r.enqueue(jobID) })

			return
		}

		rec.Fail(ctx, err)
		r.onTerminalFailure(ctx, job, rec)

		return
	}

	rec.Succeed(ctx)
}

func (r *flowJobRunner) claim(jobID int64) bool {
	r.inFlightMX.Lock()
	defer r.inFlightMX.Unlock()

	if _, busy := r.inFlight[jobID]; busy {
		return false
	}

	r.inFlight[jobID] = struct{}{}

	return true
}

func (r *flowJobRunner) release(jobID int64) {
	r.inFlightMX.Lock()
	defer r.inFlightMX.Unlock()

	delete(r.inFlight, jobID)
}

// onTerminalFailure leaves the flow itself in a state the user can act on: a
// creation that never completed is marked failed (kept, not silently deleted, so
// the UI can show why) and a cleanup that failed keeps its error on the job.
func (r *flowJobRunner) onTerminalFailure(ctx context.Context, job database.FlowJob, rec *lifecycleRecorder) {
	if job.Kind != FlowJobKindCreate {
		return
	}

	flow, err := r.fc.setFlowFailed(ctx, job.FlowID, rec)
	if err != nil {
		rec.logger.WithError(err).Warn("failed to mark flow failed after a failed creation")
		return
	}

	containers, err := r.fc.db.GetFlowContainers(ctx, flow.ID)
	if err != nil {
		rec.logger.WithError(err).Warn("failed to load containers for the failed flow")
		return
	}

	r.fc.subs.NewFlowPublisher(job.UserID, flow.ID).FlowUpdated(ctx, flow, containers)
}

func (r *flowJobRunner) executeCreate(ctx context.Context, job database.FlowJob, rec *lifecycleRecorder) error {
	payload, err := decodeFlowJobPayload(job.Payload)
	if err != nil {
		return err
	}

	functions, err := payload.functions()
	if err != nil {
		return err
	}

	flow, err := r.fc.db.GetFlow(ctx, job.FlowID)
	if err != nil {
		return fmt.Errorf("failed to load flow %d for initialization: %w", job.FlowID, err)
	}
	if flow.Status == database.FlowStatusFinished || flow.Status == database.FlowStatusFailed {
		return nil // A queued cleanup may have completed while creation was waiting to retry.
	}

	unlock := r.fc.lockFlowLifecycle(job.FlowID)
	defer unlock()

	if _, err := r.fc.GetFlow(ctx, job.FlowID); err == nil {
		rec.Mark(ctx, "already_initialized")

		return nil
	}

	fw, err := NewFlowWorker(ctx, flow, newFlowWorkerCtx{
		userID:    job.UserID,
		input:     payload.Input,
		prvname:   provider.ProviderName(flow.ModelProviderName),
		prvtype:   provider.ProviderType(flow.ModelProviderType),
		functions: functions,
		resources: payload.Resources,
		recording: rec,
		flowWorkerCtx: flowWorkerCtx{
			db:     r.fc.db,
			cfg:    r.fc.cfg,
			docker: r.fc.docker,
			provs:  r.fc.provs,
			subs:   r.fc.subs,
			flowProviderControllers: flowProviderControllers{
				mlc:  r.fc.mlc,
				aslc: r.fc.aslc,
				alc:  r.fc.alc,
				slc:  r.fc.slc,
				tlc:  r.fc.tlc,
				vslc: r.fc.vslc,
				tclc: r.fc.tclc,
				sc:   r.fc.sc,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to initialize flow %d: %w", job.FlowID, err)
	}

	r.fc.mx.Lock()
	r.fc.flows[flow.ID] = fw
	r.fc.mx.Unlock()

	return nil
}

func (r *flowJobRunner) executeFinish(ctx context.Context, job database.FlowJob, rec *lifecycleRecorder) error {
	return rec.Step(ctx, "cleanup", "cleaning_up", func(ctx context.Context) error {
		return r.fc.finishFlow(ctx, job.FlowID)
	})
}

func (r *flowJobRunner) executeStop(ctx context.Context, job database.FlowJob, rec *lifecycleRecorder) error {
	unlock := r.fc.lockFlowLifecycle(job.FlowID)
	defer unlock()
	fw, err := r.fc.GetFlow(ctx, job.FlowID)
	if err != nil {
		return err
	}
	return rec.Step(ctx, "stop", "stopping", fw.Stop)
}

func (r *flowJobRunner) executeDelete(ctx context.Context, job database.FlowJob, rec *lifecycleRecorder) error {
	unlock := r.fc.lockFlowLifecycle(job.FlowID)
	defer unlock()

	if err := rec.Step(ctx, "cleanup", "cleaning_up", func(ctx context.Context) error {
		return r.fc.finishFlowLocked(ctx, job.FlowID)
	}); err != nil {
		return err
	}
	flow, err := r.fc.db.GetFlow(ctx, job.FlowID)
	if err == sql.ErrNoRows {
		return nil // A previous attempt already deleted the record.
	}
	if err != nil {
		return err
	}
	containers, err := r.fc.db.GetFlowContainers(ctx, flow.ID)
	if err != nil {
		return err
	}
	if _, err := r.fc.db.DeleteFlow(ctx, flow.ID); err != nil {
		return err
	}
	// Vector documents the flow produced: long-term memory plus the knowledge
	// entries its agents stored. Best effort — the flow row is already gone and
	// an orphaned document must not block the delete.
	if err := r.fc.db.DeleteFlowDocuments(ctx, database.StringToNullString(fmt.Sprint(flow.ID))); err != nil {
		rec.logger.WithError(err).Warn("failed to remove deleted flow documents")
	}
	r.fc.subs.NewFlowPublisher(flow.UserID, flow.ID).FlowDeleted(ctx, flow, containers)
	return nil
}

func flowJobRetryWait(attempts int16) time.Duration {
	if attempts < 1 {
		attempts = 1
	}

	return flowJobRetryBaseWait * time.Duration(attempts)
}

// newFlowJobCorrelationID builds the identifier that ties a user-visible action
// to the log lines and the job row it produced.
func newFlowJobCorrelationID(kind string) string {
	return fmt.Sprintf("%s-%s", kind, uuid.NewString()[:8])
}

// setFlowFailed moves a flow that never finished initializing to `failed`.
func (fc *flowController) setFlowFailed(ctx context.Context, flowID int64, rec *lifecycleRecorder) (database.Flow, error) {
	flow, err := fc.db.UpdateFlowStatus(ctx, database.UpdateFlowStatusParams{
		ID:     flowID,
		Status: database.FlowStatusFailed,
	})
	if err != nil {
		return database.Flow{}, err
	}

	fc.mx.Lock()
	delete(fc.flows, flowID)
	fc.mx.Unlock()

	if rec != nil {
		rec.logger.WithField("status", flow.Status).Warn("flow marked failed")
	}

	return flow, nil
}

// GetLatestFlowJob returns the newest lifecycle job of a flow, which is what the
// UI shows as its pending step or last failure. `ok` is false when the flow has
// never had one.
func (fc *flowController) GetLatestFlowJob(ctx context.Context, flowID int64) (database.FlowJob, bool) {
	job, err := fc.db.GetLatestFlowJob(ctx, flowID)
	if err != nil {
		if err != sql.ErrNoRows {
			logrus.WithContext(ctx).WithError(err).WithField("flow_id", flowID).
				Warn("failed to load the latest lifecycle job")
		}

		return database.FlowJob{}, false
	}

	return job, true
}
