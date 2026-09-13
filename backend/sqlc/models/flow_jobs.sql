-- name: CreateFlowJob :one
INSERT INTO flow_jobs (
  flow_id, user_id, kind, status, step, correlation_id, payload, max_attempts
)
VALUES (
  $1, $2, $3, 'queued', 'queued', $4, $5, $6
)
RETURNING *;

-- name: GetFlowJob :one
SELECT
  *
FROM flow_jobs
WHERE id = $1;

-- name: GetActiveFlowJob :one
SELECT
  *
FROM flow_jobs
WHERE flow_id = $1 AND kind = $2 AND status IN ('queued', 'running')
ORDER BY id DESC
LIMIT 1;

-- name: GetLatestFlowJob :one
SELECT
  *
FROM flow_jobs
WHERE flow_id = $1
ORDER BY id DESC
LIMIT 1;

-- name: GetLatestFlowJobsByFlowIDs :many
SELECT DISTINCT ON (flow_id)
  *
FROM flow_jobs
WHERE flow_id = ANY($1::bigint[])
ORDER BY flow_id, id DESC;

-- name: ListPendingFlowJobs :many
SELECT
  *
FROM flow_jobs
WHERE status IN ('queued', 'running')
ORDER BY id
LIMIT $1;

-- name: ClaimFlowJob :one
UPDATE flow_jobs
SET status = 'running',
    attempts = attempts + 1,
    started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND status IN ('queued', 'running')
RETURNING *;

-- name: UpdateFlowJobProgress :one
UPDATE flow_jobs
SET step = $2,
    segments = $3,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING *;

-- name: RequeueFlowJob :one
UPDATE flow_jobs
SET status = 'queued',
    step = $2,
    error = $3,
    segments = $4,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING *;

-- name: CompleteFlowJob :one
UPDATE flow_jobs
SET status = 'succeeded',
    step = 'done',
    error = NULL,
    segments = $2,
    finished_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING *;

-- name: FailFlowJob :one
UPDATE flow_jobs
SET status = 'failed',
    step = 'failed',
    error = $2,
    segments = $3,
    finished_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING *;

-- name: RecoverInterruptedFlowJobs :many
-- A job left running belongs to a process that died. It goes back to the queue
-- (keeping its attempts count) so start-up can retry or fail it explicitly
-- rather than leaving it "running" forever.
UPDATE flow_jobs
SET status = 'queued',
    step = 'recovered',
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'running'
RETURNING *;

-- name: DeleteFinishedFlowJobsOlderThan :exec
DELETE FROM flow_jobs
WHERE status IN ('succeeded', 'failed') AND updated_at < $1;
