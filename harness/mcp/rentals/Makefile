# rentals-search-mcp Makefile — same vibes as flights-search-mcp
#
# Run `make` or `make help` to see everything.

.DEFAULT_GOAL := help

.PHONY: help fmt vet lint test test-short test-race coverage check \
	build cli install tidy deps clean self-test \
	install-hooks tools run release version

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION) -X github.com/shotah/rentals-search-mcp/internal/mcp.ServerVersion=$(VERSION)

BUMP ?= patch
PKG ?= ./...

BINARY ?= bin/rentals-search-mcp
ifeq ($(OS),Windows_NT)
BINARY := bin/rentals-search-mcp.exe
endif

# Pure-Go by default. SteamOS (and similar) often has gcc without libc headers,
# so Go's net package dies in cgo_linux.go. Matches cli / distroless / GoReleaser.
# Override with CGO_ENABLED=1 if you have a full C toolchain and want cgo.
export CGO_ENABLED ?= 0

##@ Getting oriented

help: ## Show this help
	@echo.
	@echo Usage:  make ^<target^>
	@echo.
	@echo Daily loop ^(format -^> lint -^> test^)
	@echo   fmt                    Format imports/code ^(goimports-reviser^)
	@echo   vet                    Static analysis ^(go vet^)
	@echo   lint                   Full lint suite ^(golangci-lint^)
	@echo   test                   Unit tests ^(PKG=./path/... for one package^)
	@echo   test-short             Unit tests with -short
	@echo   coverage               Coverage report ^(fails if ^< 70%^)
	@echo   check                  Autofix, lint, test, coverage ^(matches pre-commit^)
	@echo.
	@echo Build ^& run
	@echo   build                  Compile all packages
	@echo   cli                    Build static MCP binary into ./bin/
	@echo   install                Install rentals-search-mcp into GOPATH/bin
	@echo   self-test              Build + run --self-test
	@echo   run                    go run MCP  ^(make run ARGS=--self-test^)
	@echo.
	@echo Modules ^& cleanup
	@echo   tidy                   Sync go.mod / go.sum
	@echo   deps                   Download module deps
	@echo   clean                  Remove binaries and coverage artifacts
	@echo.
	@echo Project-specific
	@echo   install-hooks          Install git pre-commit ^(autofix + lint + test + coverage^)
	@echo   version                Show VERSION file + next patch ^(dry-run^)
	@echo   release                Bump tag + latest, update VERSION, push ^(BUMP=patch^|minor^|major^)
	@echo.
	@echo Tooling
	@echo   tools                  Install goimports-reviser + golangci-lint v2
	@echo.

##@ Daily loop

fmt: ## Autofix imports/code
	goimports-reviser -format -recursive .
	-golangci-lint fmt ./...
	-golangci-lint run --fix ./...

vet: ## Static analysis
	go vet ./...

lint: ## Full lint suite
	golangci-lint run ./...

test: ## Unit tests
	go test $(PKG)

test-short: ## Unit tests with -short
	go test -short $(PKG)

test-race: ## Race detector
	go test -race $(PKG)

COVERAGE_MIN ?= 70

coverage: ## Coverage report (fails if total < COVERAGE_MIN%)
	go test "-coverprofile=coverage.out" -covermode=atomic ./...
	go tool cover "-func=coverage.out"
	go run ./scripts/check-coverage.go coverage.out $(COVERAGE_MIN)

check: fmt lint test coverage ## Autofix, lint, test, coverage (matches pre-commit)

##@ Build & run

build: ## Compile all packages
	go build ./...

cli: ## Build static MCP binary into ./bin/
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BINARY) ./cmd/rentals-search-mcp

install: ## Install into GOPATH/bin
	CGO_ENABLED=0 go install -trimpath -ldflags "$(LDFLAGS)" ./cmd/rentals-search-mcp

run: ## go run MCP — e.g. make run ARGS="--self-test"
	go run -ldflags "$(LDFLAGS)" ./cmd/rentals-search-mcp $(ARGS)

self-test: cli ## Build + run --self-test
	./$(BINARY) --self-test

##@ Modules & cleanup

tidy: ## Sync go.mod / go.sum
	go mod tidy

deps: ## Download module deps
	go mod download

clean: ## Remove binaries and coverage
	go clean ./...
ifeq ($(OS),Windows_NT)
	-cmd /C "rmdir /S /Q bin 2>NUL & del /Q coverage coverage.out coverage.txt rentals-search-mcp.exe 2>NUL"
else
	rm -rf bin
	rm -f coverage coverage.out coverage.txt rentals-search-mcp rentals-search-mcp.exe
endif

##@ Release

install-hooks: ## Install git pre-commit hook (autofix + lint + test + coverage)
ifeq ($(OS),Windows_NT)
	@powershell -NoProfile -Command "\
		if (-not (Test-Path '.git')) { Write-Host 'No .git - run git init locally first when you are ready.'; exit 1 }; \
		$$t = [IO.File]::ReadAllText('scripts/pre-commit') -replace \"`r`n\", \"`n\" -replace \"`r\", \"`n\"; \
		[IO.File]::WriteAllText('.git/hooks/pre-commit', $$t, [Text.UTF8Encoding]::new($$false))"
else
	@test -d .git || (echo "No .git - run git init locally first when you are ready." && exit 1)
	cp scripts/pre-commit .git/hooks/pre-commit
	chmod +x .git/hooks/pre-commit
endif
	@echo "Installed .git/hooks/pre-commit"
	@echo "Hook runs: CGO_ENABLED=0 goimports-reviser -> golangci-lint -> go test -> coverage >= 70%"

version: ## Show next patch (dry-run)
	@go run ./cmd/release -dry-run

release: ## Bump version + latest tags, update VERSION, push
	go run ./cmd/release \
		$(if $(TAG),-version=$(TAG),-bump=$(BUMP)) \
		$(if $(DRY_RUN),-dry-run,) \
		$(if $(SKIP_PUSH),-skip-push,) \
		$(if $(ALLOW_DIRTY),-allow-dirty,)

##@ Tooling

tools: ## Install goimports-reviser + golangci-lint v2 into $$GOBIN
	go install github.com/incu6us/goimports-reviser/v3@latest
	go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
	@echo Installed tools. Ensure GOPATH/bin is on PATH, then: golangci-lint version
