package controller

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"pentagi/pkg/config"
	"pentagi/pkg/database"
	"pentagi/pkg/docker"
	"pentagi/pkg/graph/subscriptions"
	"pentagi/pkg/providers"
	"pentagi/pkg/providers/provider"
	"pentagi/pkg/tools"

	"github.com/sirupsen/logrus"
)

var (
	ErrFlowNotFound       = fmt.Errorf("flow not found")
	ErrFlowAlreadyStopped = fmt.Errorf("flow already stopped")
)

type FlowController interface {
	CreateFlow(
		ctx context.Context,
		userID int64,
		input string,
		prvname provider.ProviderName,
		prvtype provider.ProviderType,
		functions *tools.Functions,
		resources []database.UserResource,
	) (int64, error)
	CreateAssistant(
		ctx context.Context,
		userID int64,
		flowID int64,
		input string,
		useAgents bool,
		prvname provider.ProviderName,
		prvtype provider.ProviderType,
		functions *tools.Functions,
		resources []database.UserResource,
	) (AssistantWorker, error)
	LoadFlows(ctx context.Context) error
	ListFlows(ctx context.Context) []FlowWorker
	GetFlow(ctx context.Context, flowID int64) (FlowWorker, error)
	StopFlow(ctx context.Context, flowID int64) error
	FinishFlow(ctx context.Context, flowID int64) error
	GetLatestFlowJob(ctx context.Context, flowID int64) (database.FlowJob, bool)
	RenameFlow(ctx context.Context, flowID int64, title string) error
	RenameFlowsProvider(ctx context.Context, userID int64, oldName, newName provider.ProviderName) error
	ResetFlowsProviderToDefault(
		ctx context.Context,
		userID int64,
		oldName provider.ProviderName,
		prvtype provider.ProviderType,
	) error
}

// reassignProviderTimeout bounds the provider reference sweep. It is generous
// for two indexed UPDATEs and only exists so a stuck database cannot pin the
// goroutine forever once the sweep is detached from the request context.
const reassignProviderTimeout = 30 * time.Second

type flowController struct {
	// lifecycleMX preserves mutation ordering while mx only protects the registry.
	// Model calls and worker shutdown must never hold the registry lock: list and
	// lookup requests need to remain responsive while those operations wait.
	lifecycleMX sync.Mutex
	db          database.Querier
	mx          *sync.Mutex
	cfg         *config.Config
	flows       map[int64]FlowWorker
	docker      docker.DockerClient
	provs       providers.ProviderController
	subs        subscriptions.SubscriptionsController
	alc         AgentLogController
	mlc         MsgLogController
	aslc        AssistantLogController
	slc         SearchLogController
	tlc         TermLogController
	vslc        VectorStoreLogController
	tclc        ToolCallLogController
	sc          ScreenshotController
	// jobs runs create/stop/finish work in the background and keeps the record of
	// it. Guarded by its own mutex, not by lifecycleMX: the whole point is that a
	// request returns before the slow part starts.
	jobs      *flowJobRunner
	recentMX  sync.Mutex
	recentSub map[string]recentFlowCreate
}

// recentFlowCreate remembers a create submission for flowJobSubmitWindow, so a
// double submit is answered with the flow already being initialized.
type recentFlowCreate struct {
	flowID   int64
	accepted time.Time
}

func NewFlowController(
	db database.Querier,
	cfg *config.Config,
	docker docker.DockerClient,
	provs providers.ProviderController,
	subs subscriptions.SubscriptionsController,
) FlowController {
	fc := &flowController{
		db:        db,
		mx:        &sync.Mutex{},
		cfg:       cfg,
		flows:     make(map[int64]FlowWorker),
		docker:    docker,
		provs:     provs,
		subs:      subs,
		alc:       NewAgentLogController(db),
		mlc:       NewMsgLogController(db),
		aslc:      NewAssistantLogController(db),
		slc:       NewSearchLogController(db),
		tlc:       NewTermLogController(db),
		vslc:      NewVectorStoreLogController(db),
		tclc:      NewToolCallLogController(db),
		sc:        NewScreenshotController(db),
		recentSub: map[string]recentFlowCreate{},
	}
	fc.jobs = newFlowJobRunner(fc)

	return fc
}

func (fc *flowController) LoadFlows(ctx context.Context) error {
	fc.lifecycleMX.Lock()
	defer fc.lifecycleMX.Unlock()
	flows, err := fc.db.GetFlows(ctx)
	if err != nil {
		return fmt.Errorf("failed to load flows: %w", err)
	}

	for _, flow := range flows {
		fw, err := LoadFlowWorker(ctx, flow, flowWorkerCtx{
			db:     fc.db,
			cfg:    fc.cfg,
			docker: fc.docker,
			provs:  fc.provs,
			subs:   fc.subs,
			flowProviderControllers: flowProviderControllers{
				mlc:  fc.mlc,
				aslc: fc.aslc,
				alc:  fc.alc,
				slc:  fc.slc,
				tlc:  fc.tlc,
				vslc: fc.vslc,
				tclc: fc.tclc,
				sc:   fc.sc,
			},
		})
		if err != nil {
			if errors.Is(err, ErrNothingToLoad) {
				continue
			}

			logrus.WithContext(ctx).WithError(err).Errorf("failed to load flow %d", flow.ID)
			continue
		}

		fc.mx.Lock()
		fc.flows[flow.ID] = fw
		fc.mx.Unlock()
	}

	// Jobs left queued or running by a previous process are picked up here, so a
	// restart either finishes the work or records why it could not.
	fc.jobs.Start(ctx)

	return nil
}

// CreateFlow persists the flow row and a queued lifecycle job, then returns
// without waiting for initialization. Provider probing, docker preparation and
// the subscription publishes happen on the job runner, so a slow model or a slow
// docker daemon no longer holds the request (and the registry lock) hostage.
//
// The returned id is usable right away: the flow row exists with status
// `created`, which is what the UI shows as "initializing".
func (fc *flowController) CreateFlow(
	ctx context.Context,
	userID int64,
	input string,
	prvname provider.ProviderName,
	prvtype provider.ProviderType,
	functions *tools.Functions,
	resources []database.UserResource,
) (int64, error) {
	fc.lifecycleMX.Lock()
	defer fc.lifecycleMX.Unlock()

	if flowID, ok := fc.recentCreateFlow(userID, input, prvname); ok {
		logrus.WithContext(ctx).WithFields(logrus.Fields{
			"flow_id":    flowID,
			"user_id":    userID,
			"duplicate":  true,
			"window_sec": int(flowJobSubmitWindow / time.Second),
		}).Info("duplicate flow creation reused the flow already initializing")

		return flowID, nil
	}

	flow, err := createFlowRow(ctx, fc.db, userID, prvname, prvtype)
	if err != nil {
		return 0, err
	}

	functionsBlob, err := json.Marshal(functions)
	if err != nil {
		return flow.ID, fmt.Errorf("failed to encode flow functions: %w", err)
	}

	payload, err := encodeFlowJobPayload(flowJobPayload{
		Input:     input,
		Functions: functionsBlob,
		Resources: resources,
	})
	if err != nil {
		return flow.ID, err
	}

	job, err := fc.db.CreateFlowJob(ctx, database.CreateFlowJobParams{
		FlowID:        flow.ID,
		UserID:        userID,
		Kind:          FlowJobKindCreate,
		CorrelationID: newFlowJobCorrelationID(FlowJobKindCreate),
		Payload:       payload,
		MaxAttempts:   flowJobMaxAttempts,
	})
	if err != nil {
		return flow.ID, fmt.Errorf("failed to queue flow %d initialization: %w", flow.ID, err)
	}

	logrus.WithContext(ctx).WithFields(logrus.Fields{
		"flow_id":        flow.ID,
		"user_id":        userID,
		"job_id":         job.ID,
		"correlation_id": job.CorrelationID,
		"provider_name":  prvname.String(),
	}).Info("flow initialization queued")

	fc.rememberCreateFlow(userID, input, prvname, flow.ID)
	fc.jobs.enqueue(job.ID)

	return flow.ID, nil
}

// recentCreateKey identifies an identical create submission: same user, same
// provider, same task text.
func recentCreateKey(userID int64, input string, prvname provider.ProviderName) string {
	sum := sha256.Sum256([]byte(input))

	return fmt.Sprintf("%d|%s|%x", userID, prvname.String(), sum[:8])
}

func (fc *flowController) rememberCreateFlow(userID int64, input string, prvname provider.ProviderName, flowID int64) {
	fc.recentMX.Lock()
	defer fc.recentMX.Unlock()

	fc.pruneRecentCreateFlows()

	fc.recentSub[recentCreateKey(userID, input, prvname)] = recentFlowCreate{
		flowID:   flowID,
		accepted: time.Now(),
	}
}

func (fc *flowController) recentCreateFlow(userID int64, input string, prvname provider.ProviderName) (int64, bool) {
	fc.recentMX.Lock()
	defer fc.recentMX.Unlock()

	fc.pruneRecentCreateFlows()

	record, ok := fc.recentSub[recentCreateKey(userID, input, prvname)]
	if !ok {
		return 0, false
	}

	return record.flowID, true
}

// pruneRecentCreateFlows drops submissions older than the window. Called with
// recentMX held.
func (fc *flowController) pruneRecentCreateFlows() {
	cutoff := time.Now().Add(-flowJobSubmitWindow)

	for key, record := range fc.recentSub {
		if record.accepted.Before(cutoff) {
			delete(fc.recentSub, key)
		}
	}
}

func (fc *flowController) CreateAssistant(
	ctx context.Context,
	userID int64,
	flowID int64,
	input string,
	useAgents bool,
	prvname provider.ProviderName,
	prvtype provider.ProviderType,
	functions *tools.Functions,
	resources []database.UserResource,
) (AssistantWorker, error) {
	fc.lifecycleMX.Lock()
	defer fc.lifecycleMX.Unlock()

	var (
		fw  FlowWorker
		err error
	)

	flowWorkerCtx := flowWorkerCtx{
		db:     fc.db,
		cfg:    fc.cfg,
		docker: fc.docker,
		provs:  fc.provs,
		subs:   fc.subs,
		flowProviderControllers: flowProviderControllers{
			mlc:  fc.mlc,
			aslc: fc.aslc,
			alc:  fc.alc,
			slc:  fc.slc,
			tlc:  fc.tlc,
			vslc: fc.vslc,
			tclc: fc.tclc,
			sc:   fc.sc,
		},
	}

	newFlow := func() error {
		flow, err := createFlowRow(ctx, fc.db, userID, prvname, prvtype)
		if err != nil {
			return err
		}

		fw, err = NewFlowWorker(ctx, flow, newFlowWorkerCtx{
			userID:    userID,
			input:     input,
			dryRun:    true,
			prvname:   prvname,
			prvtype:   prvtype,
			functions: functions,
			// A failed assistant start has no job record to report itself through,
			// so the row it just created is removed again.
			dropRowOnFailure: true,
			flowWorkerCtx:    flowWorkerCtx,
		})
		if err != nil {
			return fmt.Errorf("failed to create flow worker: %w", err)
		}

		fc.mx.Lock()
		fc.flows[fw.GetFlowID()] = fw
		fc.mx.Unlock()
		flowID = fw.GetFlowID()
		fw.SetStatus(ctx, database.FlowStatusWaiting)

		return nil
	}

	loadFlow := func() error {
		flow, err := fc.db.UpdateFlowStatus(ctx, database.UpdateFlowStatusParams{
			ID:     flowID,
			Status: database.FlowStatusWaiting,
		})
		if err != nil {
			return fmt.Errorf("failed to renew flow %d status: %w", flowID, err)
		}

		fw, err = LoadFlowWorker(ctx, flow, flowWorkerCtx)
		if err != nil {
			return fmt.Errorf("failed to load flow %d: %w", flowID, err)
		}

		fc.mx.Lock()
		fc.flows[flowID] = fw
		fc.mx.Unlock()

		return nil
	}

	if flowID == 0 {
		if err := newFlow(); err != nil {
			return nil, err
		}
	} else if fw, err = fc.GetFlow(ctx, flowID); err == nil {
		status, err := fw.GetStatus(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to get flow %d status: %w", flowID, err)
		}

		switch status {
		case database.FlowStatusCreated:
			return nil, fmt.Errorf("flow %d is not completed", flowID)
		case database.FlowStatusFinished, database.FlowStatusFailed:
			if err := loadFlow(); err != nil {
				return nil, err
			}
		case database.FlowStatusRunning, database.FlowStatusWaiting:
			break
		default:
			return nil, fmt.Errorf("flow %d is in unknown status: %s", flowID, status)
		}
	} else {
		if err := loadFlow(); err != nil {
			return nil, err
		}
	}

	if fw == nil { // just double check, this should never happen
		return nil, fmt.Errorf("unexpected error: flow %d not found", flowID)
	}

	aw, err := NewAssistantWorker(ctx, newAssistantWorkerCtx{
		userID:        userID,
		flowID:        flowID,
		input:         input,
		prvname:       prvname,
		prvtype:       prvtype,
		useAgents:     useAgents,
		functions:     functions,
		resources:     resources,
		fw:            fw,
		flowWorkerCtx: flowWorkerCtx,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create assistant: %w", err)
	}

	if err = fw.AddAssistant(ctx, aw); err != nil {
		return nil, fmt.Errorf("failed to add assistant to flow: %w", err)
	}

	return aw, nil
}

func (fc *flowController) ListFlows(ctx context.Context) []FlowWorker {
	fc.mx.Lock()

	flows := make([]FlowWorker, 0)
	for _, flow := range fc.flows {
		flows = append(flows, flow)
	}

	fc.mx.Unlock()

	sort.Slice(flows, func(i, j int) bool {
		return flows[i].GetFlowID() < flows[j].GetFlowID()
	})

	return flows
}

func (fc *flowController) GetFlow(ctx context.Context, flowID int64) (FlowWorker, error) {
	fc.mx.Lock()
	defer fc.mx.Unlock()

	flow, ok := fc.flows[flowID]
	if !ok {
		return nil, ErrFlowNotFound
	}

	return flow, nil
}

func (fc *flowController) StopFlow(ctx context.Context, flowID int64) error {
	fc.lifecycleMX.Lock()
	defer fc.lifecycleMX.Unlock()

	flow, err := fc.GetFlow(ctx, flowID)
	if err != nil {
		return err
	}

	// Stopping is a bounded wait (stopTaskTimeout), so it stays in the request —
	// but it is recorded like every other lifecycle operation, which is what makes
	// "how long did stopping take, and where" answerable.
	job, err := fc.createLifecycleJob(ctx, flowID, FlowJobKindStop, flowJobPayload{})
	if err != nil {
		return err
	}

	claimed, err := fc.db.ClaimFlowJob(ctx, job.ID)
	if err != nil {
		return fmt.Errorf("failed to claim stop job %d: %w", job.ID, err)
	}

	rec := newLifecycleRecorder(fc.db, claimed)

	err = rec.Step(ctx, "stop", "stopping", func(ctx context.Context) error {
		return flow.Stop(ctx)
	})
	if err != nil {
		rec.Fail(ctx, err)

		return fmt.Errorf("failed to stop flow %d: %w", flowID, err)
	}

	rec.Succeed(ctx)

	return nil
}

// FinishFlow queues the cleanup and returns as soon as it is recorded. The
// caller learns the outcome from the flow's job (GetLatestFlowJob), not from a
// success that only means "the request did not fail".
func (fc *flowController) FinishFlow(ctx context.Context, flowID int64) error {
	if _, err := fc.GetFlow(ctx, flowID); err != nil {
		return err
	}

	job, err := fc.createLifecycleJob(ctx, flowID, FlowJobKindFinish, flowJobPayload{})
	if err != nil {
		return err
	}

	fc.jobs.enqueue(job.ID)

	return nil
}

// finishFlow is the cleanup itself, run by the lifecycle job runner: stop the
// tasks, finish the assistants, release the executor and only then mark the flow
// finished.
func (fc *flowController) finishFlow(ctx context.Context, flowID int64) error {
	fc.lifecycleMX.Lock()
	defer fc.lifecycleMX.Unlock()

	flow, err := fc.GetFlow(ctx, flowID)
	if err != nil {
		return err
	}

	if err := flow.Finish(ctx); err != nil {
		return fmt.Errorf("failed to finish flow %d: %w", flowID, err)
	}

	fc.mx.Lock()
	delete(fc.flows, flowID)
	fc.mx.Unlock()

	return nil
}

// createLifecycleJob writes the durable record of a lifecycle operation. The
// partial unique index on (flow_id, kind) makes a concurrent duplicate fail here
// instead of running the work twice.
func (fc *flowController) createLifecycleJob(
	ctx context.Context,
	flowID int64,
	kind string,
	payload flowJobPayload,
) (database.FlowJob, error) {
	flow, err := fc.db.GetFlow(ctx, flowID)
	if err != nil {
		return database.FlowJob{}, fmt.Errorf("failed to load flow %d for a %s job: %w", flowID, kind, err)
	}

	encoded, err := encodeFlowJobPayload(payload)
	if err != nil {
		return database.FlowJob{}, err
	}

	job, err := fc.db.CreateFlowJob(ctx, database.CreateFlowJobParams{
		FlowID:        flowID,
		UserID:        flow.UserID,
		Kind:          kind,
		CorrelationID: newFlowJobCorrelationID(kind),
		Payload:       encoded,
		MaxAttempts:   flowJobMaxAttempts,
	})
	if err != nil {
		return database.FlowJob{}, fmt.Errorf("a %s job for flow %d is already queued or running", kind, flowID)
	}

	return job, nil
}

func (fc *flowController) RenameFlow(ctx context.Context, flowID int64, title string) error {
	fc.lifecycleMX.Lock()
	defer fc.lifecycleMX.Unlock()

	flow, err := fc.GetFlow(ctx, flowID)
	if err != nil {
		return err
	}

	return flow.Rename(ctx, title)
}

// RenameFlowsProvider repoints every flow and assistant of userID that still
// refers to oldName at newName, after the user renamed a custom LLM provider.
func (fc *flowController) RenameFlowsProvider(
	ctx context.Context,
	userID int64,
	oldName, newName provider.ProviderName,
) error {
	return fc.reassignFlowsProvider(ctx, userID, oldName, newName)
}

// ResetFlowsProviderToDefault repoints every flow and assistant of userID that
// referred to a just-deleted custom LLM provider at the built-in name for its
// type, which is literally the type string ("qwen", "openai", ...) — see
// provider.DefaultProviderName*. That name always resolves, so the flow stays
// loadable instead of failing with "provider not found by name".
func (fc *flowController) ResetFlowsProviderToDefault(
	ctx context.Context,
	userID int64,
	oldName provider.ProviderName,
	prvtype provider.ProviderType,
) error {
	return fc.reassignFlowsProvider(ctx, userID, oldName, provider.ProviderName(prvtype))
}

// reassignFlowsProvider rewrites the provider reference stored on a user's flow
// and assistant rows. It deliberately does *not* touch loaded workers:
//
//   - Nothing here blocks on an LLM. Building a provider instance probes the
//     upstream API to resolve a tool call ID template, so switching loaded
//     workers inline would tie a "rename provider" click to LLM latency and give
//     the caller time to cancel the request mid-cascade.
//   - Nothing here takes fc.mx or reaches into a worker, so the cascade cannot
//     deadlock against, or stall, any other flow operation.
//
// A running flow picks the change up on the user's next input (which already
// re-resolves the provider by name and calls flowWorker.switchProvider) or on
// the next backend start (which rebuilds the provider from the DB row). Both
// paths compare the provider's raw configuration, so they also catch the case
// where the name did not change but the configuration behind it did.
//
// The two sweeps only match rows still bearing oldName, which makes the whole
// operation idempotent and safe to retry. They are issued independently and
// their errors are joined, so a failure on one table never silently skips the
// other.
func (fc *flowController) reassignFlowsProvider(
	ctx context.Context,
	userID int64,
	oldName, newName provider.ProviderName,
) error {
	logger := logrus.WithContext(ctx).WithFields(logrus.Fields{
		"user_id":  userID,
		"old_name": oldName.String(),
		"new_name": newName.String(),
	})

	if oldName == newName {
		logger.Debug("provider name unchanged, nothing to reassign")
		return nil
	}

	// Only references that would otherwise dangle get rewritten. oldName can
	// still resolve after the provider is gone when it named an override of a
	// built-in — an intentional feature — in which case the built-in answers to
	// that name again and the stored value is already correct. Rewriting it
	// anyway would repoint rows that predate the override, and (when the
	// override's type differed from the built-in it was named after) would send
	// them to the wrong default entirely.
	if _, err := fc.provs.GetProvider(ctx, oldName, userID); err == nil {
		logger.Debug("old provider name still resolves, nothing to reassign")
		return nil
	}

	// Detached from the caller's request context: these are two short statements
	// and the reference must not be left half-rewritten because a browser tab
	// was closed. The timeout keeps a stuck DB from pinning the goroutine.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), reassignProviderTimeout)
	defer cancel()

	flows, flowsErr := fc.db.UpdateFlowsProviderNameByOldName(ctx, database.UpdateFlowsProviderNameByOldNameParams{
		NewName: newName.String(),
		UserID:  userID,
		OldName: oldName.String(),
	})
	if flowsErr != nil {
		logger.WithError(flowsErr).Error("failed to bulk-update flows provider name")
		flowsErr = fmt.Errorf("failed to bulk-update flows provider name: %w", flowsErr)
	}

	assistants, asstErr := fc.db.UpdateAssistantsProviderNameByOldName(
		ctx, database.UpdateAssistantsProviderNameByOldNameParams{
			NewName: newName.String(),
			UserID:  userID,
			OldName: oldName.String(),
		})
	if asstErr != nil {
		logger.WithError(asstErr).Error("failed to bulk-update assistants provider name")
		asstErr = fmt.Errorf("failed to bulk-update assistants provider name: %w", asstErr)
	}

	// Publishing happens only after both writes are done. A subscriber that is
	// not draining its channel makes each publish cost up to the subscription
	// send timeout, so doing it in between would let a wedged websocket client
	// eat the deadline and starve the second UPDATE.
	for _, flow := range flows {
		// Skipped rather than published with no containers: FlowUpdated carries
		// the full terminal list and the client replaces its cached value with
		// whatever arrives, so an empty list would wipe the flow's terminals in
		// the UI. Same handling as flowWorker.switchProvider.
		containers, err := fc.db.GetFlowContainers(ctx, flow.ID)
		if err != nil {
			logger.WithError(err).Warnf("failed to get containers for flow %d, skipping its update event", flow.ID)
			continue
		}
		fc.subs.NewFlowPublisher(userID, flow.ID).FlowUpdated(ctx, flow, containers)
	}

	for _, assistant := range assistants {
		fc.subs.NewFlowPublisher(userID, assistant.FlowID).AssistantUpdated(ctx, assistant)
	}

	logger.WithFields(logrus.Fields{
		"flows_updated":      len(flows),
		"assistants_updated": len(assistants),
	}).Info("provider reference reassigned")

	return errors.Join(flowsErr, asstErr)
}
