# syntax=docker/dockerfile:1

# Compile on the builder's native arch ($BUILDPLATFORM) and cross-compile with
# GOOS/GOARCH. CGO is off, so linux/arm64 does not need QEMU.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

ARG TARGETOS=linux
ARG TARGETARCH=amd64
ARG VERSION=dev
ARG COMMIT=none
ARG DATE=unknown

ENV CGO_ENABLED=0
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build \
    -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.date=${DATE}" \
    -o /out/gantry \
    ./cmd/gantry

# Every module under mcp/*/ (its own go.mod). Missing or empty mcp/ still
# produces an empty /opt/mcp. Catalog shapes land beside each binary when
# that module implements `host-manifest`. mcp.lock is not consulted.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS mcp
WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY . .

ARG TARGETOS=linux
ARG TARGETARCH=amd64
ENV TARGETOS=${TARGETOS}
ENV TARGETARCH=${TARGETARCH}
ENV CGO_ENABLED=0

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    sh scripts/build-mcp.sh

# Runtime: distroless/static — ca-certs + tzdata, no shell, uid 65532.
# MCP binaries are static (CGO off) under /opt/mcp/<id>/ and on PATH
# via /usr/local/bin (id, plus the host-manifest "command" name).
FROM gcr.io/distroless/static-debian12:nonroot

ARG VERSION=dev
ARG COMMIT=none
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${COMMIT}"

COPY --from=mcp /opt/mcp /opt/mcp
COPY --from=mcp /export/bin/ /usr/local/bin/
COPY --from=build /out/gantry /usr/local/bin/gantry

USER nonroot
WORKDIR /data

ENTRYPOINT ["/usr/local/bin/gantry"]
CMD ["run"]
