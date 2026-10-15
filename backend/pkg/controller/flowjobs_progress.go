package controller

import "context"

// Begin keeps the currently running phase visible while a provider or Docker
// call is still in progress. Synchronous upstream paths have no recorder.
func (r *lifecycleRecorder) Begin(ctx context.Context, name string) {
	if r != nil {
		r.persist(ctx, name)
	}
}
