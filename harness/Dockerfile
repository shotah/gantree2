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

# The runtime stage has no shell, so the writable dirs the harness needs
# (PERSONA_DIR=/persona, DATA_DIR=/data, and /etc/gantry, the parent of
# MCP_MANIFEST=/etc/gantry/mcp.toml that the config frame writes) are made
# here and copied over with the nonroot uid. Without this the first boot
# dies on `snapshot: mkdir: mkdir /etc/gantry: permission denied`.
RUN mkdir -p /out/persona /out/data /out/etc/gantry

# Every module under mcp/*/ (its own go.mod). Missing or empty mcp/ still
# produces an empty /opt/mcp. One binary per plugin at /opt/mcp/<id>/<id>.
# Catalog shapes land beside that binary when the module implements
# `host-manifest`. mcp.lock is not consulted.
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
# MCP binaries are static (CGO off), one per plugin at /opt/mcp/<id>/<id>.
# The harness resolves a bare mcp.toml command to that path.
FROM gcr.io/distroless/static-debian12:nonroot

ARG VERSION=dev
ARG COMMIT=none
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${COMMIT}"

COPY --from=mcp /opt/mcp /opt/mcp
COPY --from=build /out/gantry /usr/local/bin/gantry
# nonroot is uid/gid 65532 in distroless. All three trees are written at
# boot: the config frame lays PERSONA.md and mcp.toml, the snapshot restore
# lays SELF.md and gantry.db.
COPY --from=build --chown=65532:65532 /out/persona /persona
COPY --from=build --chown=65532:65532 /out/data /data
COPY --from=build --chown=65532:65532 /out/etc/gantry /etc/gantry

USER nonroot
WORKDIR /data

ENTRYPOINT ["/usr/local/bin/gantry"]
CMD ["run"]
