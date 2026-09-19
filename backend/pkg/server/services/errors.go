package services

import "errors"

// inputError marks a failure caused by the caller's request rather than by the
// server. REST handlers answer 400 for these, while the background orchestrator
// treats the same error as a stage failure.
type inputError struct {
	message string
	err     error
}

func (e *inputError) Error() string {
	if e.err == nil {
		return e.message
	}
	return e.message + ": " + e.err.Error()
}

func (e *inputError) Unwrap() error { return e.err }

func newInputError(message string, err error) error {
	return &inputError{message: message, err: err}
}

// inputErrorMessage reports the caller-facing message of an inputError.
func inputErrorMessage(err error) (string, bool) {
	var target *inputError
	if errors.As(err, &target) {
		return target.message, true
	}
	return "", false
}
