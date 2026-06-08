/**
 * root-hints.js
 *
 * Hardcoded list of all 13 DNS root servers with their current IPv4 addresses,
 * operators, and locations. These are used as the starting point for iterative
 * DNS resolution (Root → TLD → Authoritative).
 *
 * Source: IANA Root Hints File (https://www.iana.org/domains/root/servers)
 */

const ROOT_SERVERS = [
  {
    name:     'a.root-servers.net',
    ipv4:     '198.41.0.4',
    operator: 'Verisign, Inc.',
    location: 'Dulles, VA, US',
  },
  {
    name:     'b.root-servers.net',
    ipv4:     '170.247.170.2',
    operator: 'USC-ISI',
    location: 'Los Angeles, CA, US',
  },
  {
    name:     'c.root-servers.net',
    ipv4:     '192.33.4.12',
    operator: 'Cogent Communications',
    location: 'Herndon, VA, US',
  },
  {
    name:     'd.root-servers.net',
    ipv4:     '199.7.91.13',
    operator: 'University of Maryland',
    location: 'College Park, MD, US',
  },
  {
    name:     'e.root-servers.net',
    ipv4:     '192.203.230.10',
    operator: 'NASA Ames Research Center',
    location: 'Mountain View, CA, US',
  },
  {
    name:     'f.root-servers.net',
    ipv4:     '192.5.5.241',
    operator: 'Internet Systems Consortium (ISC)',
    location: 'Palo Alto, CA, US',
  },
  {
    name:     'g.root-servers.net',
    ipv4:     '192.112.36.4',
    operator: 'US Department of Defense (DISA)',
    location: 'Columbus, OH, US',
  },
  {
    name:     'h.root-servers.net',
    ipv4:     '198.97.190.53',
    operator: 'US Army Research Lab',
    location: 'Aberdeen, MD, US',
  },
  {
    name:     'i.root-servers.net',
    ipv4:     '192.36.148.17',
    operator: 'Netnod',
    location: 'Stockholm, SE',
  },
  {
    name:     'j.root-servers.net',
    ipv4:     '192.58.128.30',
    operator: 'Verisign, Inc.',
    location: 'Dulles, VA, US',
  },
  {
    name:     'k.root-servers.net',
    ipv4:     '193.0.14.129',
    operator: 'RIPE NCC',
    location: 'Amsterdam, NL',
  },
  {
    name:     'l.root-servers.net',
    ipv4:     '199.7.83.42',
    operator: 'ICANN',
    location: 'Los Angeles, CA, US',
  },
  {
    name:     'm.root-servers.net',
    ipv4:     '202.12.27.33',
    operator: 'WIDE Project',
    location: 'Tokyo, JP',
  },
];

module.exports = ROOT_SERVERS;
