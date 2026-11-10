import { describe, expect, it } from "vitest";
import { refusedHost } from "@/harness/core/egress";

function refused(raw: string): string | null {
  return refusedHost(new URL(raw));
}

describe("refusedHost", () => {
  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://100.100.100.100/",
    "http://0.0.0.0/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fc00::1]/",
    "http://[fd7a:115c:a1e0::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.5]/",
    "http://[::ffff:169.254.169.254]/",
  ])("refuses the address in %s", (raw) => {
    expect(refused(raw)).toBe("url host is not a public address");
  });

  it.each([
    "http://localhost/",
    "http://LOCALHOST/",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://db.internal/",
    "http://localhost./",
    "http://printer.local./",
  ])("refuses the name in %s", (raw) => {
    expect(refused(raw)).toBe("url host is not a public name");
  });

  it.each([
    ["http://2130706433/", "127.0.0.1"],
    ["http://0x7f.1/", "127.0.0.1"],
    ["http://0177.0.0.1/", "127.0.0.1"],
    ["http://127.1/", "127.0.0.1"],
    ["http://127.0.0.1./", "127.0.0.1"],
    ["http://0xa9fea9fe/", "169.254.169.254"],
  ])("refuses the disguised form %s", (raw, host) => {
    expect(new URL(raw).hostname).toBe(host);
    expect(refused(raw)).toBe("url host is not a public address");
  });

  it.each([
    "http://user:pass@127.0.0.1:8080/",
    "https://admin@192.168.1.1:65535/feed",
    "http://[::1]:9000/",
    "http://u:p@localhost:3000/",
  ])("refuses a private host with credentials or a port: %s", (raw) => {
    expect(refused(raw)).not.toBeNull();
  });

  it.each([
    "https://example.com/feed.xml",
    "http://example.com/rss",
    "https://8.8.8.8/",
    "http://172.32.0.1/",
    "http://172.15.255.255/",
    "http://100.128.0.1/",
    "http://100.63.255.255/",
    "http://11.0.0.1/",
    "http://192.169.0.1/",
    "http://169.255.0.1/",
    "https://[2606:4700:4700::1111]/",
    "https://localhost.example.com/",
    "https://internal.example.com/",
    "https://user:pass@example.com:8443/feed",
  ])("allows the public host in %s", (raw) => {
    expect(refused(raw)).toBeNull();
  });
});
