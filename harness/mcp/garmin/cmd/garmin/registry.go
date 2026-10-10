package main

import (
	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/endpoint/definitions"
)

// endpointRegistry is the global registry for all endpoint definitions.
var endpointRegistry *endpoint.Registry

func init() {
	endpointRegistry = endpoint.NewRegistry()
	definitions.RegisterAll(endpointRegistry)
}
