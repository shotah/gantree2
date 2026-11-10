/**
 * Refuse URLs a tool must not fetch: loopback, private, link-local, CGNAT
 * (Tailscale), unique-local, multicast, reserved, and IPv4-mapped forms of
 * those, plus localhost and .local / .internal names. Only plain unicast IP
 * literals pass.
 *
 * Checks the host as the WHATWG URL parser normalised it, so 2130706433,
 * 0x7f.1, and 0177.0.0.1 arrive as 127.0.0.1. A public name that resolves to
 * a private address (DNS rebinding) is not caught: neither the Worker nor
 * celld lets this code resolve a name and pin the connection to the checked
 * address.
 */
import ipaddr from "ipaddr.js";

export function refusedHost(url: URL): string | null {
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (ipaddr.isValid(host)) {
    return ipaddr.process(host).range() === "unicast" ? null : "url host is not a public address";
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return "url host is not a public name";
  }
  return null;
}
