// Pinned IANA special-purpose registries, reviewed 2026-10-13.
// https://www.iana.org/assignments/iana-ipv4-special-registry
// https://www.iana.org/assignments/iana-ipv6-special-registry
// Parent prefixes include their more-specific exceptions: none are allowed here.
export const IPV4_DENY = Object.freeze([
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.31.196.0/24",
  "192.52.193.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "192.175.48.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
]);
// Only 2000::/3 is eligible; all other special-purpose space is denied by that gate.
export const IPV6_DENY = Object.freeze([
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "2620:4f:8000::/48",
  "3fff::/20",
]);
