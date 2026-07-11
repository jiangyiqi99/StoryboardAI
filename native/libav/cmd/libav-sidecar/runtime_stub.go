//go:build !libav

package main

type unavailableRuntime struct{}

func newRuntime() runtime { return unavailableRuntime{} }

func (unavailableRuntime) Call(method string, _ map[string]any) (any, *rpcError) {
	return nil, &rpcError{
		Code:    "LIBAV_NOT_LINKED",
		Message: "This sidecar was built without libav. Rebuild with: go build -tags libav ./cmd/libav-sidecar",
		Details: map[string]any{"operation": method},
	}
}

func (unavailableRuntime) Close() {}
