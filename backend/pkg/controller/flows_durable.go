package controller

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"pentagi/pkg/cast"
	"pentagi/pkg/database"
	"pentagi/pkg/providers/provider"
	"pentagi/pkg/tools"

	"github.com/sirupsen/logrus"
)

func (fc *flowController) lockFlowLifecycle(flowID int64) func() {
	value, _ := fc.flowLifecycleMX.LoadOrStore(flowID, &sync.Mutex{})
	mx := value.(*sync.Mutex)
	mx.Lock()

	return mx.Unlock
}

// recentFlowCreate remembers a create submission for flowJobSubmitWindow, so a
// double submit is answered with the flow already being initialized.
type recentFlowCreate struct {
	flowID   int64
	accepted time.Time
}

func (fc *flowController) createDurableFlow(
	ctx context.Context,
	userID int64,
	input string,
	prvname provider.ProviderName,
	prvtype provider.ProviderType,
	functions *tools.Functions,
	resources []database.UserResource,
) (int64, error) {
	fc.submitMX.Lock()
	defer fc.submitMX.Unlock()

	functionsBlob, err := json.Marshal(functions)
	if err != nil {
		return 0, fmt.Errorf("failed to encode flow functions: %w", err)
	}

	payload, err := encodeFlowJobPayload(flowJobPayload{
		Input:     input,
		Functions: functionsBlob,
		Resources: resources,
	})
	if err != nil {
		return 0, err
	}

	submission := prvtype.String() + string(payload)
	if flowID, ok := fc.recentCreateFlow(ctx, userID, submission, prvname); ok {
		logrus.WithContext(ctx).WithFields(logrus.Fields{
			"flow_id":    flowID,
			"user_id":    userID,
			"duplicate":  true,
			"window_sec": int(flowJobSubmitWindow / time.Second),
		}).Info("duplicate flow creation reused the flow already initializing")

		return flowID, nil
	}

	flow, err := fc.db.CreateFlowWithJob(ctx, database.CreateFlowWithJobParams{
		ModelProviderName: prvname.String(), ModelProviderType: database.ProviderType(prvtype),
		ToolCallIDTemplate: cast.ToolCallIDTemplate, UserID: userID,
		CorrelationID: newFlowJobCorrelationID(FlowJobKindCreate), Payload: payload, MaxAttempts: flowJobMaxAttempts,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to queue flow initialization: %w", err)
	}
	job, err := fc.db.GetActiveFlowJob(ctx, database.GetActiveFlowJobParams{FlowID: flow.ID, Kind: FlowJobKindCreate})
	if err != nil {
		return flow.ID, nil
	} // The durable poller still owns this accepted job.

	logrus.WithContext(ctx).WithFields(logrus.Fields{
		"flow_id":        flow.ID,
		"user_id":        userID,
		"job_id":         job.ID,
		"correlation_id": job.CorrelationID,
		"provider_name":  prvname.String(),
	}).Info("flow initialization queued")

	fc.rememberCreateFlow(userID, submission, prvname, flow.ID)
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

	if fc.recentSub == nil {
		fc.recentSub = map[string]recentFlowCreate{}
	}
	fc.recentSub[recentCreateKey(userID, input, prvname)] = recentFlowCreate{
		flowID:   flowID,
		accepted: time.Now(),
	}
}

func (fc *flowController) recentCreateFlow(ctx context.Context, userID int64, input string, prvname provider.ProviderName) (int64, bool) {
	fc.recentMX.Lock()
	defer fc.recentMX.Unlock()

	fc.pruneRecentCreateFlows()

	record, ok := fc.recentSub[recentCreateKey(userID, input, prvname)]
	if !ok {
		return 0, false
	}

	row, err := fc.db.GetFlow(ctx, record.flowID)
	if err != nil || row.Status != database.FlowStatusCreated {
		return 0, false
	}
	if _, err := fc.db.GetActiveFlowJob(ctx, database.GetActiveFlowJobParams{FlowID: record.flowID, Kind: FlowJobKindCreate}); err != nil {
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

func (fc *flowController) DeleteFlow(ctx context.Context, flowID int64) error {
	job, err := fc.createLifecycleJob(ctx, flowID, FlowJobKindDelete, flowJobPayload{})
	if err != nil {
		return err
	}
	fc.jobs.enqueue(job.ID)
	return nil
}

// finishFlow is the cleanup itself, run by the lifecycle job runner: stop the
// tasks, finish the assistants, release the executor and only then mark the flow
// finished.

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
		if kind != FlowJobKindStop {
			active, activeErr := fc.db.GetActiveFlowJob(ctx, database.GetActiveFlowJobParams{FlowID: flowID, Kind: kind})
			if activeErr == nil {
				return active, nil
			}
		}
		return database.FlowJob{}, fmt.Errorf("failed to queue %s job for flow %d: %w", kind, flowID, err)
	}

	return job, nil
}

func (fc *flowController) finishFlow(ctx context.Context, flowID int64) error {
	err := fc.finishFlowWithin(ctx, flowID, flowFinishTimeout)
	if err == ErrFlowNotFound {
		return nil
	}
	return err
}
func (fc *flowController) finishFlowLocked(ctx context.Context, flowID int64) error {
	return fc.finishFlow(ctx, flowID)
}
