# go-garmin Makefile — Go training wheels for the Python-brained
#
# Run `make` or `make help` to see everything.
# Tip: Go already has great CLI ergonomics; these targets just wrap the common ones.

.DEFAULT_GOAL := help

.PHONY: help fmt vet lint test test-integration test-race test-short coverage check \
	build cli install tidy deps clean record-fixtures record fixtures auth \
	validate-endpoints install-hooks tools run release version

# Build-time version stamp (git describe). Release tags are tracked in ./VERSION.
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -X main.version=$(VERSION)

# Release bump: patch (default), minor, or major. Or set TAG=v0.2.0 explicitly.
BUMP ?= patch

# Optional: `make test PKG=./endpoint/...` or `make coverage PKG=./...`
PKG ?= ./...

##@ Getting oriented

help: ## Show this help
	@echo.
	@echo Usage:  make ^<target^>
	@echo.
	@echo Getting oriented
	@echo   help                   Show this help
	@echo.
	@echo Daily loop (format -^> lint -^> test)
	@echo   fmt                    Format imports/code (goimports-reviser)
	@echo   vet                    Static analysis (go vet)
	@echo   lint                   Full lint suite (golangci-lint)
	@echo   test                   Unit tests only (no VCR integration)
	@echo   test-integration       VCR cassette tests (-tags=integration)
	@echo   test-short             Unit tests with -short
	@echo   test-race              Unit tests with the race detector
	@echo   coverage               Library coverage report (excludes cmd/)
	@echo   check                  Autofix, lint, validate endpoints, and unit tests
	@echo.
	@echo Build ^& run
	@echo   build                  Compile all packages (sanity check)
	@echo   cli                    Build the garmin CLI binary into ./bin/garmin
	@echo   install                Install garmin into GOPATH/bin
	@echo   run                    go run CLI  (make run ARGS="--help")
	@echo.
	@echo Modules ^& cleanup
	@echo   tidy                   Sync go.mod / go.sum with imports
	@echo   deps                   Download module deps
	@echo   clean                  Remove binaries and coverage artifacts
	@echo.
	@echo Project-specific
	@echo   validate-endpoints     Check endpoint definitions are complete
	@echo   auth                   Interactive Garmin login -^> settings.json
	@echo   fixtures               Record/update all VCR cassettes
	@echo   record                 Alias for fixtures
	@echo   record-fixtures        Build VCR fixture recorder into ./bin/
	@echo   install-hooks          Install git pre-commit (autofix + lint + test)
	@echo   version                Show current VERSION file + latest git tag
	@echo   release                Bump tag + latest, update VERSION, push (BUMP=patch^|minor^|major)
	@echo.
	@echo Tooling
	@echo   tools                  Install goimports-reviser + golangci-lint v2
	@echo.

##@ Daily loop (format → lint → test)

fmt: ## Autofix imports/code (goimports-reviser + golangci-lint fmt/fix)
	goimports-reviser -format -recursive .
	-golangci-lint fmt ./...
	-golangci-lint run --fix ./...

vet: ## Static analysis (go vet) — catches bugs gofmt won't
	go vet ./...

lint: ## Full lint suite (golangci-lint; no write)
	golangci-lint run ./...

test: ## Unit tests only (PKG=./path/... for one package; no VCR integration)
	go test $(PKG)

test-integration: ## VCR integration tests (run make auth && make fixtures first)
	@echo "Note: refresh cassettes with: make auth && make fixtures"
	go test ./garmin/ -tags=integration -count=1 -timeout 5m

test-short: ## Unit tests with -short
	go test -short $(PKG)

test-race: ## Unit tests with the race detector (slower, worth it)
	go test -race $(PKG)

# Default coverage scope excludes cmd/ (CLI mains drag totals down).
# Override: make coverage PKG=./...
COVERAGE_PKG ?= ./garmin/... ./endpoint/... ./exercises/... ./testutil/...

coverage: ## Tests + coverage report for library packages (writes coverage.out)
	go test -cover "-coverprofile=coverage.out" $(COVERAGE_PKG)
	go tool cover "-func=coverage.out"

check: fmt lint validate-endpoints test ## Autofix, lint, validate, test (matches pre-commit)

##@ Build & run

build: ## Compile all packages (sanity check; no binary kept)
	go build ./...

cli: ## Build the garmin CLI binary into ./bin/garmin
	mkdir -p bin
	go build -ldflags "$(LDFLAGS)" -o bin/garmin ./cmd/garmin

install: ## Install garmin into $$GOPATH/bin (or $$GOBIN)
	go install -ldflags "$(LDFLAGS)" ./cmd/garmin

run: ## Build & run CLI — e.g. make run ARGS="sleep --help"
	go run ./cmd/garmin $(ARGS)

##@ Modules & cleanup

tidy: ## Sync go.mod / go.sum with imports (python: pip freeze vibes)
	go mod tidy

deps: ## Download module deps into the module cache
	go mod download

clean: ## Remove built binaries and coverage artifacts
	go clean ./...
ifeq ($(OS),Windows_NT)
	-cmd /C "rmdir /S /Q bin 2>NUL & del /Q garmin.exe record-fixtures record-fixtures.exe coverage coverage.out coverage.txt validate-endpoints validate-endpoints.exe har-parser har-parser.exe 2>NUL"
else
	rm -rf bin
	rm -f garmin.exe record-fixtures record-fixtures.exe coverage coverage.out coverage.txt validate-endpoints validate-endpoints.exe har-parser har-parser.exe
endif

##@ Project-specific

validate-endpoints: ## Check endpoint definitions are complete
	go run ./cmd/validate-endpoints

record-fixtures: ## Build VCR fixture recorder → ./bin/record-fixtures
	mkdir -p bin
	go build -o bin/record-fixtures ./cmd/record-fixtures
	@echo ""
	@echo "Workflow:  make auth  &&  make fixtures"
	@echo "See TESTING.md for details."

# Interactive login (email/password/MFA) → settings.json at module root.
auth: ## Interactive Garmin auth → settings.json
	go run ./cmd/garmin-auth

# Requires settings.json from `make auth`.
# Examples:
#   make fixtures
#   make fixtures CASSETTE=usersummary
#   make fixtures DATE=2026-07-14
fixtures: ## Record/update VCR cassettes (uses settings.json)
	go run ./cmd/record-fixtures $(if $(CASSETTE),-cassette=$(CASSETTE),) $(if $(DATE),-date=$(DATE),)

record: fixtures ## Alias for fixtures

install-hooks: ## Install git pre-commit hook (autofix + lint + test)
ifeq ($(OS),Windows_NT)
	copy /Y scripts\pre-commit .git\hooks\pre-commit
else
	cp scripts/pre-commit .git/hooks/pre-commit
	chmod +x .git/hooks/pre-commit
endif
	@echo "Installed .git/hooks/pre-commit"

version: ## Show VERSION file and latest git tag / next patch
	@go run ./cmd/release -dry-run

# Bump semver, commit VERSION, annotated-tag (v* + floating latest), push (triggers GoReleaser).
# Examples:
#   make release
#   make release BUMP=minor
#   make release BUMP=major
#   make release TAG=v0.2.0
#   make release DRY_RUN=1
release: ## Bump version + latest tags, update VERSION, push (BUMP=patch|minor|major)
	go run ./cmd/release \
		$(if $(TAG),-version=$(TAG),-bump=$(BUMP)) \
		$(if $(DRY_RUN),-dry-run,) \
		$(if $(SKIP_PUSH),-skip-push,) \
		$(if $(ALLOW_DIRTY),-allow-dirty,)

##@ Tooling (skip if you use nix develop / direnv)

tools: ## Install goimports-reviser + golangci-lint v2 into $$GOBIN
	go install github.com/incu6us/goimports-reviser/v3@latest
	go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
	@echo Installed tools. Ensure GOPATH/bin is on PATH, then: golangci-lint version
