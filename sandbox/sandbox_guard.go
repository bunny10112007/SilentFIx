package sandbox

import (
	"context"
	"fmt"
	"os/exec"
	"time"
)

type VerificationRequest struct {
	PatchID     string
	TimeoutSec  int
	SourceBytes []byte
}

type SandboxResult struct {
	Success  bool
	Output   string
	Duration time.Duration
}

func VerifyPatchInSandbox(ctx context.Context, req VerificationRequest) (*SandboxResult, error) {
	timeout := time.Duration(req.TimeoutSec) * time.Second
	if timeout == 0 {
		timeout = 5 * time.Second
	}
	evalCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Execute inside restricted isolate process
	cmd := exec.CommandContext(evalCtx, "nsjail", "--config", "/etc/silentfix/nsjail.conf", "--")
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to bind sandbox pipe: %w", err)
	}

	go func() {
		defer stdinPipe.Close()
		stdinPipe.Write(req.SourceBytes)
	}()

	start := time.Now()
	out, err := cmd.CombinedOutput()
	elapsed := time.Since(start)

	if err != nil {
		return &SandboxResult{
			Success:  false,
			Output:   string(out),
			Duration: elapsed,
		}, nil
	}

	return &SandboxResult{
		Success:  true,
		Output:   string(out),
		Duration: elapsed,
	}, nil
}
