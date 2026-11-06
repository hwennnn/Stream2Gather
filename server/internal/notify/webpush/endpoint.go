package webpush

import (
	"net"
	"net/url"
	"strings"
)

// services are the hosts browsers hand out. An endpoint comes from a client and
// the notifier posts to it, so anything else would let a caller aim it at our network.
var services = []string{
	"fcm.googleapis.com",
	"push.apple.com",
	"push.services.mozilla.com",
	"notify.windows.com",
}

// Allowed reports whether the notifier may post to this endpoint. allowLocal
// admits a fake push service on this machine, for development.
func Allowed(endpoint string, allowLocal bool) bool {
	address, err := url.Parse(endpoint)
	if err != nil || address.User != nil {
		return false
	}
	host := address.Hostname()
	if allowLocal && address.Scheme == "http" {
		if ip := net.ParseIP(host); host == "localhost" || (ip != nil && ip.IsLoopback()) {
			return true
		}
	}
	if address.Scheme != "https" || (address.Port() != "" && address.Port() != "443") {
		return false
	}
	for _, service := range services {
		if host == service || strings.HasSuffix(host, "."+service) {
			return true
		}
	}
	return false
}
