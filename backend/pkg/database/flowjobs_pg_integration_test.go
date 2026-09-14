package database_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"pentagi/pkg/database"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

// TestFlowJobsAgainstRealPostgres exercises the sqlc queries generated for the
// flow_jobs migration against a real PostgreSQL. The fake store used by
// pkg/controller tests mirrors the intended schema by hand, so this is the only
// place where the migration, the generated SQL and the partial unique index are
// checked together.
//
// Opt-in: set PENTAGI_TEST_PG_DSN, e.g.
//
//	PENTAGI_TEST_PG_DSN='postgres://postgres:pass@host:5432/pentagi_test?sslmode=disable' go test ./pkg/database -run FlowJobs -v
func TestFlowJobsAgainstRealPostgres(t *testing.T) {
	dsn := os.Getenv("PENTAGI_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("PENTAGI_TEST_PG_DSN is not set")
	}

	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	defer db.Close()

	require.NoError(t, db.PingContext(context.Background()))

	q := database.New(db)
	ctx := context.Background()

	userID := insertUser(t, db)
	t.Run("flow and lifecycle job commit atomically", func(t *testing.T) {
		arg := database.CreateFlowWithJobParams{UserID: userID, ModelProviderName: "deepseek", ModelProviderType: database.ProviderType("deepseek"), ToolCallIDTemplate: "test", CorrelationID: "atomic", Payload: json.RawMessage(`{}`), MaxAttempts: 3}
		created, err := q.CreateFlowWithJob(ctx, arg)
		require.NoError(t, err)
		job, err := q.GetActiveFlowJob(ctx, database.GetActiveFlowJobParams{FlowID: created.ID, Kind: "create"})
		require.NoError(t, err)
		require.Equal(t, created.ID, job.FlowID)
		_, err = db.ExecContext(ctx, `DELETE FROM flows WHERE id=$1`, created.ID)
		require.NoError(t, err)
		var before, after int
		require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM flows WHERE user_id=$1`, userID).Scan(&before))
		arg.Payload = nil // violates the job NOT NULL constraint after inserting the flow CTE
		_, err = q.CreateFlowWithJob(ctx, arg)
		require.Error(t, err)
		require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM flows WHERE user_id=$1`, userID).Scan(&after))
		require.Equal(t, before, after, "failed job insert must roll back the flow")
	})
	flow, err := q.CreateFlow(ctx, database.CreateFlowParams{
		Title:              "flow jobs verification",
		Status:             database.FlowStatusCreated,
		Model:              "unknown",
		ModelProviderName:  "deepseek",
		ModelProviderType:  database.ProviderType("deepseek"),
		Language:           "English",
		ToolCallIDTemplate: "verify",
		Functions:          json.RawMessage(`{}`),
		UserID:             userID,
	})
	require.NoError(t, err)

	var (
		jobID    int64
		segments = json.RawMessage(`[{"name":"db","ms":12},{"name":"provider","ms":340}]`)
	)

	t.Run("create is queued with zero attempts", func(t *testing.T) {
		job := createJob(t, q, flow.ID, userID, "create")
		jobID = job.ID

		require.Equal(t, "queued", job.Status)
		require.Equal(t, "queued", job.Step)
		require.Zero(t, job.Attempts)
		require.EqualValues(t, 3, job.MaxAttempts)
		require.False(t, job.StartedAt.Valid)
		require.False(t, job.FinishedAt.Valid)
	})

	t.Run("a second active job of the same kind is rejected", func(t *testing.T) {
		_, err := q.CreateFlowJob(ctx, database.CreateFlowJobParams{
			FlowID:        flow.ID,
			UserID:        userID,
			Kind:          "create",
			CorrelationID: "create-duplicate",
			Payload:       json.RawMessage(`{}`),
			MaxAttempts:   3,
		})
		require.Error(t, err, "flow_jobs_active_uniq must reject a duplicate active job")
	})

	t.Run("claim increments attempts and stamps started_at", func(t *testing.T) {
		claimed, err := q.ClaimFlowJob(ctx, jobID)
		require.NoError(t, err)
		require.Equal(t, "running", claimed.Status)
		require.EqualValues(t, 1, claimed.Attempts)
		require.True(t, claimed.StartedAt.Valid)
		_, err = q.ClaimFlowJob(ctx, jobID)
		require.ErrorIs(t, err, sql.ErrNoRows, "a running job cannot be claimed by a second executor")
	})

	t.Run("progress keeps the segments", func(t *testing.T) {
		job, err := q.UpdateFlowJobProgress(ctx, database.UpdateFlowJobProgressParams{
			ID:       jobID,
			Step:     "probing_provider",
			Segments: segments,
		})
		require.NoError(t, err)
		require.Equal(t, "probing_provider", job.Step)
		require.JSONEq(t, string(segments), string(job.Segments))
	})

	t.Run("requeue records the failure and reopens the job", func(t *testing.T) {
		job, err := q.RequeueFlowJob(ctx, database.RequeueFlowJobParams{
			ID:       jobID,
			Step:     "retrying",
			Error:    database.StringToNullString("provider unreachable"),
			Segments: segments,
		})
		require.NoError(t, err)
		require.Equal(t, "queued", job.Status)
		require.Equal(t, "provider unreachable", job.Error.String)
		require.JSONEq(t, string(segments), string(job.Segments))

		// A requeued job is still "active", so the unique index keeps rejecting
		// a second create for the same flow while it is being retried.
		_, err = q.CreateFlowJob(ctx, database.CreateFlowJobParams{
			FlowID:        flow.ID,
			UserID:        userID,
			Kind:          "create",
			CorrelationID: "create-during-retry",
			Payload:       json.RawMessage(`{}`),
			MaxAttempts:   3,
		})
		require.Error(t, err)
	})

	t.Run("the second claim carries the previous attempt count", func(t *testing.T) {
		_, err := q.ClaimFlowJob(ctx, jobID)
		require.ErrorIs(t, err, sql.ErrNoRows, "retry must respect the durable backoff")
		_, err = db.ExecContext(ctx, `UPDATE flow_jobs SET updated_at = CURRENT_TIMESTAMP - INTERVAL '10 seconds' WHERE id = $1`, jobID)
		require.NoError(t, err)
		claimed, err := q.ClaimFlowJob(ctx, jobID)
		require.NoError(t, err)
		require.EqualValues(t, 2, claimed.Attempts, "retry accounting depends on attempts surviving the requeue")
	})

	t.Run("complete records the terminal state", func(t *testing.T) {
		job, err := q.CompleteFlowJob(ctx, database.CompleteFlowJobParams{ID: jobID, Segments: segments})
		require.NoError(t, err)
		require.Equal(t, "succeeded", job.Status)
		require.Equal(t, "done", job.Step)
		require.False(t, job.Error.Valid)
		require.True(t, job.FinishedAt.Valid)
	})

	t.Run("a finished job frees the slot for a new one", func(t *testing.T) {
		job := createJob(t, q, flow.ID, userID, "create")
		require.NotEqual(t, jobID, job.ID)

		// Leave the flow with no active create job for the subtests below.
		_, err := q.FailFlowJob(ctx, database.FailFlowJobParams{
			ID:       job.ID,
			Error:    database.StringToNullString("verification cleanup"),
			Segments: segments,
		})
		require.NoError(t, err)
	})

	t.Run("recovery puts an interrupted running job back in the queue", func(t *testing.T) {
		interrupted := createJob(t, q, flow.ID, userID, "finish")
		_, err := q.ClaimFlowJob(ctx, interrupted.ID)
		require.NoError(t, err)

		recovered, err := q.RecoverInterruptedFlowJobs(ctx)
		require.NoError(t, err)

		var found database.FlowJob
		for _, job := range recovered {
			if job.ID == interrupted.ID {
				found = job
			}
		}
		require.Equal(t, interrupted.ID, found.ID, "the interrupted job must be recovered")
		require.Equal(t, "queued", found.Status)
		require.Equal(t, "recovered", found.Step)
	})

	t.Run("pending lists queued and running jobs", func(t *testing.T) {
		pending, err := q.ListPendingFlowJobs(ctx, 32)
		require.NoError(t, err)
		require.NotEmpty(t, pending)

		statuses := map[string]int{}
		for _, job := range pending {
			statuses[job.Status]++
			require.Contains(t, []string{"queued", "running"}, job.Status)
		}
		require.Positive(t, statuses["queued"])
	})

	t.Run("latest job is the newest one of the flow", func(t *testing.T) {
		latest, err := q.GetLatestFlowJob(ctx, flow.ID)
		require.NoError(t, err)

		all, err := q.ListPendingFlowJobs(ctx, 32)
		require.NoError(t, err)

		var maxID int64
		for _, job := range all {
			if job.FlowID == flow.ID && job.ID > maxID {
				maxID = job.ID
			}
		}
		if maxID > 0 {
			require.Equal(t, maxID, latest.ID)
		}
	})

	t.Run("retention deletes finished jobs only", func(t *testing.T) {
		running := createJob(t, q, flow.ID, userID, "stop")
		_, err := q.ClaimFlowJob(ctx, running.ID)
		require.NoError(t, err)

		require.NoError(t, q.DeleteFinishedFlowJobsOlderThan(ctx, time.Now().Add(time.Minute)))

		_, err = q.GetFlowJob(ctx, jobID)
		require.ErrorIs(t, err, sql.ErrNoRows, "a finished job older than the cutoff must be deleted")

		stillThere, err := q.GetFlowJob(ctx, running.ID)
		require.NoError(t, err)
		require.Equal(t, "running", stillThere.Status, "an active job must survive retention")
	})

	t.Run("a hard delete of the flow cascades into its jobs", func(t *testing.T) {
		// DeleteFlow is a soft delete (deleted_at), so only a real DELETE
		// triggers the FK cascade. Asserted here because the cascade is what
		// keeps orphaned jobs out of the pending index once a row is purged.
		doomed := createJob(t, q, flow.ID, userID, "cascade")

		_, err := db.ExecContext(ctx, `DELETE FROM flows WHERE id = $1`, flow.ID)
		require.NoError(t, err)

		_, err = q.GetFlowJob(ctx, doomed.ID)
		require.ErrorIs(t, err, sql.ErrNoRows)
	})

	t.Run("a soft-deleted flow keeps its jobs but cannot be reinitialized", func(t *testing.T) {
		other := hardDeleteFlow(t, q, db, userID)
		job := createJob(t, q, other, userID, "create")

		_, err := q.DeleteFlow(ctx, other)
		require.NoError(t, err)

		kept, err := q.GetFlowJob(ctx, job.ID)
		require.NoError(t, err, "a soft delete leaves the job history in place")
		require.Equal(t, "queued", kept.Status)

		_, err = q.GetFlow(ctx, other)
		require.ErrorIs(t, err, sql.ErrNoRows,
			"GetFlow filters deleted_at, which is what stops a leftover job from initializing a deleted flow")
	})

	t.Run("a deleted flow shows up in the recycle bin and can be restored", func(t *testing.T) {
		restorable := hardDeleteFlow(t, q, db, userID)

		_, err := q.DeleteFlow(ctx, restorable)
		require.NoError(t, err)

		deleted, err := q.GetUserDeletedFlows(ctx, userID)
		require.NoError(t, err)
		require.True(t, containsFlow(deleted, restorable), "the bin lists the soft-deleted flow")

		restored, err := q.RestoreUserFlow(ctx, database.RestoreUserFlowParams{ID: restorable, UserID: userID})
		require.NoError(t, err)
		require.False(t, restored.DeletedAt.Valid, "restoring clears deleted_at")

		back, err := q.GetFlow(ctx, restorable)
		require.NoError(t, err, "the flow is visible again")
		require.Equal(t, restorable, back.ID)

		again, err := q.GetUserDeletedFlows(ctx, userID)
		require.NoError(t, err)
		require.False(t, containsFlow(again, restorable), "a restored flow leaves the bin")
	})

	t.Run("restore is scoped to the owner and rejects live flows", func(t *testing.T) {
		other := insertUser(t, db)
		foreign := hardDeleteFlow(t, q, db, other)

		_, err := q.DeleteFlow(ctx, foreign)
		require.NoError(t, err)

		_, err = q.RestoreUserFlow(ctx, database.RestoreUserFlowParams{ID: foreign, UserID: userID})
		require.ErrorIs(t, err, sql.ErrNoRows, "another user cannot restore the flow")
		require.False(t, containsFlow(mustDeletedFlows(t, q, userID), foreign))

		own := hardDeleteFlow(t, q, db, userID)
		_, err = q.RestoreUserFlow(ctx, database.RestoreUserFlowParams{ID: own, UserID: userID})
		require.ErrorIs(t, err, sql.ErrNoRows, "a flow that is not deleted cannot be restored twice")
	})

	t.Run("purging removes the row and cascades into its records", func(t *testing.T) {
		doomed := hardDeleteFlow(t, q, db, userID)
		job := createJob(t, q, doomed, userID, "delete")

		_, err := q.DeleteFlow(ctx, doomed)
		require.NoError(t, err)

		purged, err := q.PurgeUserFlow(ctx, database.PurgeUserFlowParams{ID: doomed, UserID: userID})
		require.NoError(t, err)
		require.Equal(t, doomed, purged.ID)

		_, err = q.GetFlowJob(ctx, job.ID)
		require.ErrorIs(t, err, sql.ErrNoRows, "the flow's job history cascades away")

		_, err = q.GetFlow(ctx, doomed)
		require.ErrorIs(t, err, sql.ErrNoRows)

		require.False(t, containsFlow(mustDeletedFlows(t, q, userID), doomed), "the bin no longer lists it")
	})

	t.Run("purging is scoped to the owner and refuses live flows", func(t *testing.T) {
		other := insertUser(t, db)
		foreign := hardDeleteFlow(t, q, db, other)

		_, err := q.DeleteFlow(ctx, foreign)
		require.NoError(t, err)

		_, err = q.PurgeUserFlow(ctx, database.PurgeUserFlowParams{ID: foreign, UserID: userID})
		require.ErrorIs(t, err, sql.ErrNoRows, "another user cannot purge the flow")
		require.True(t, containsFlow(mustDeletedFlows(t, q, other), foreign), "the flow is still in the bin")

		live := hardDeleteFlow(t, q, db, userID)
		_, err = q.PurgeUserFlow(ctx, database.PurgeUserFlowParams{ID: live, UserID: userID})
		require.ErrorIs(t, err, sql.ErrNoRows, "only a flow in the recycle bin can be purged")

		stillThere, err := q.GetFlow(ctx, live)
		require.NoError(t, err)
		require.Equal(t, live, stillThere.ID)
	})
}

func containsFlow(flows []database.Flow, id int64) bool {
	for _, flow := range flows {
		if flow.ID == id {
			return true
		}
	}

	return false
}

func mustDeletedFlows(t *testing.T, q *database.Queries, userID int64) []database.Flow {
	t.Helper()

	flows, err := q.GetUserDeletedFlows(context.Background(), userID)
	require.NoError(t, err)

	return flows
}

func insertUser(t *testing.T, db *sql.DB) int64 {
	t.Helper()

	var id int64
	err := db.QueryRow(
		`INSERT INTO users (mail, password, name) VALUES ($1, 'verify', 'verify') RETURNING id`,
		fmt.Sprintf("verify-%d@local", time.Now().UnixNano()),
	).Scan(&id)
	require.NoError(t, err)

	return id
}

func hardDeleteFlow(t *testing.T, q *database.Queries, db *sql.DB, userID int64) int64 {
	t.Helper()

	flow, err := q.CreateFlow(context.Background(), database.CreateFlowParams{
		Title:              "flow jobs verification (deleted)",
		Status:             database.FlowStatusCreated,
		Model:              "unknown",
		ModelProviderName:  "deepseek",
		ModelProviderType:  database.ProviderType("deepseek"),
		Language:           "English",
		ToolCallIDTemplate: "verify",
		Functions:          json.RawMessage(`{}`),
		UserID:             userID,
	})
	require.NoError(t, err)

	return flow.ID
}

func createJob(t *testing.T, q *database.Queries, flowID, userID int64, kind string) database.FlowJob {
	t.Helper()

	job, err := q.CreateFlowJob(context.Background(), database.CreateFlowJobParams{
		FlowID:        flowID,
		UserID:        userID,
		Kind:          kind,
		CorrelationID: fmt.Sprintf("%s-%d", kind, time.Now().UnixNano()),
		Payload:       json.RawMessage(`{"input":"verify"}`),
		MaxAttempts:   3,
	})
	require.NoError(t, err)

	return job
}
