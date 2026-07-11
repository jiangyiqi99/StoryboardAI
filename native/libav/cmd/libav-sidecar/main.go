package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
)

// The control plane deliberately uses one JSON object per line. Preview video
// frames and short PCM audio batches use the portable inline transport.
type request struct {
	ID     uint64         `json:"id"`
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

type rpcError struct {
	Code       string         `json:"code"`
	Message    string         `json:"message"`
	NativeCode *int           `json:"nativeCode,omitempty"`
	Details    map[string]any `json:"details,omitempty"`
}

type response struct {
	ID     uint64    `json:"id"`
	Result any       `json:"result,omitempty"`
	Error  *rpcError `json:"error,omitempty"`
}

type runtime interface {
	Call(method string, params map[string]any) (any, *rpcError)
	Close()
}

func main() {
	runtime := newRuntime()
	defer runtime.Close()

	encoder := json.NewEncoder(os.Stdout)
	scanner := bufio.NewScanner(os.Stdin)
	// A project/timeline control message can exceed Scanner's conservative
	// default token length while still being far smaller than a frame payload.
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			_ = encoder.Encode(response{Error: &rpcError{Code: "INVALID_REQUEST", Message: err.Error()}})
			continue
		}

		result, callErr := runtime.Call(req.Method, req.Params)
		if err := encoder.Encode(response{ID: req.ID, Result: result, Error: callErr}); err != nil {
			fmt.Fprintln(os.Stderr, "libav-sidecar: write response:", err)
			return
		}
		if req.Method == "shutdown" {
			return
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "libav-sidecar: read request:", err)
	}
}
