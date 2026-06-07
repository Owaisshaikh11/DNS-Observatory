# Custom DNS Server

- A custom DNS server with a RESTful HTTP API, designed mainly to be used in my cloud IDE project for subdomain based routing. Built with Node.js, Express, and UDP sockets, it supports dynamic subdomain management and loads DNS records from a JSON configuration file.
- Now includes Redis persistence for dynamic subdomains and Docker support for easy deployment.
- This is a personal project to learn DNS and to use it in another perssonal project that I am currently working on,
- So there may be some errors and some beginnerish mistakes in this,Please correct me if you notice any. I would greatly appreciate it :)

---

## Features

- DNS server over UDP (A, AAAA, NS, MX, TXT, CNAME records)
- Dynamic subdomain management via HTTP API
- Configurable DNS records via JSON file
- REST API for managing and querying DNS records
- Two types of dynamic subdomains:
  - Persistent Records: For long-lived subdomains (e.g., user workspaces)
  - Ephemeral Records: For temporary subdomains with TTL (e.g., preview URLs)
- Optimized Redis Hash storage model for high performance, eliminating blocking `KEYS` commands and N+1 query loops
- Robust security safeguards including DNS pointer loop DoS protection and buffer boundary checks
- Full IPv6 AAAA record support, handling both fully qualified and compressed/shorthand (e.g., `::1`) IPv6 formats
- Upstream Forwarding: Automatically forwards queries for unrecognized domains to upstream DNS servers with sequential fallback and configurable timeouts
- Docker support for easy deployment
- Easy to extend and integrate

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [HTTP API Endpoints](#http-api-endpoints)
- [Project Structure](#project-structure)
- [Limitations](#limitations)
- [License](#license)

---

## Installation

### Using Docker (Recommended)

1. **Clone the repository:**

   ```sh
   git clone https://github.com/Owaisshaikh11/custom-dns-server
   cd DNS_Project
   ```

2. **Start with Docker Compose:**

   ```sh
   docker-compose up
   ```
   This will start both the DNS server (UDP port `5354`) and Redis in containers.

### Manual Installation

1. **Clone the repository:**

   ```sh
   git clone <your-repo-url>
   cd DNS_Project
   ```

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Start Redis server** (if not using Docker)

4. **Start the DNS server:**
   ```sh
   npm start
   ```

---

## Usage

### Start the DNS Server and HTTP API

```sh
npm start
```

- DNS server runs on UDP port `5354` (changeable in `index.js`)
- HTTP API runs on port `8053`
- Redis runs on port `6379` (if using Docker)

---

## Configuration

### DNS Records
DNS records are stored in `config/dns-records.json`. Example format (flat structure):

```json
{
  "example.com": {
    "A": ["192.168.1.1"],
    "AAAA": ["2001:db8::1"],
    "NS": ["ns1.example.com", "ns2.example.com"],
    "MX": [{ "preference": 10, "exchange": "mail.example.com" }],
    "TXT": ["v=spf1 include:_spf.example.com ~all"]
  },
  "*.example.com": {
    "A": ["192.168.1.2"]
  }
}
```

### Environment Variables
- `REDIS_HOST`: Redis server host (default: `localhost`)
- `REDIS_PORT`: Redis server port (default: `6379`)
- `REDIS_PASSWORD`: Redis password (default: empty)
- `REDIS_DB`: Redis database number (default: `0`)
- `DNS_FORWARD_ENABLED`: Enable upstream forwarding fallback (default: `true`)
- `DNS_UPSTREAM_SERVERS`: Comma-separated list of DNS servers with optional custom ports (default: `8.8.8.8,8.8.4.4`)
- `DNS_FORWARD_TIMEOUT`: Timeout for upstream DNS queries in milliseconds (default: `2000`)

---

## HTTP API Endpoints

### List Dynamic Subdomains

- **GET** `/api/dns/subdomains`
- **Response:**

  ```json
  {
    "subdomains": [
      { 
        "domain": "sub.example.com", 
        "ipAddress": "1.2.3.4", 
        "expires": "2025-05-19T12:00:00.000Z",
        "isPersistent": false
      },
      {
        "domain": "workspace.example.com",
        "ipAddress": "1.2.3.5",
        "expires": null,
        "isPersistent": true
      }
    ]
  }
  ```

### Add Dynamic Subdomain

- **POST** `/api/dns/subdomains`
- **Body:**

  ```json
  { 
    "subdomain": "sub", 
    "domain": "example.com", 
    "ipAddress": "1.2.3.4", 
    "ttl": 60,
    "isPersistent": false
  }
  ```
- **Response:** 
  ```json
  {
    "success": true, 
    "domain": "sub.example.com",
    "isPersistent": false
  }
  ```

### Remove Dynamic Subdomain

- **DELETE** `/api/dns/subdomains`
- **Body:**

  ```json
  { 
    "subdomain": "sub", 
    "domain": "example.com",
    "type": "all"  // Optional: "persistent", "temp", or "all" (default)
  }
  ```
- **Response:** `{ "success": true }`

### List All DNS Records

- **GET** `/api/dns/records`
- **Response:** Full DNS records JSON

---

## Project Structure

```
DNS_Project/
├── index.js                  # Entry point
├── package.json              # Project metadata and dependencies
├── Readme.md                 # Project documentation
├── Dockerfile                # Docker configuration
├── docker-compose.yml        # Docker Compose configuration
├── api/
│   └── http-api.js           # HTTP API server
├── config/
│   ├── dns-config.js         # DNS and forwarding settings
│   ├── dns-records.json      # DNS records
│   └── redis-config.js       # Redis configuration 
├── lib/
│   ├── dns-forwarder.js      # Upstream query forwarding logic
│   ├── dns-parser.js         # DNS packet parsing logic
│   ├── dns-resolver.js       # DNS query resolution logic
│   ├── dns-writer.js         # DNS packet writing logic
│   ├── dynamic-records.js    # Dynamic subdomain management
│   ├── record-manager.js     # Record loading and saving
│   └── types.js              # Type definitions
├── server/
│   └── dns-server.js         # UDP DNS server
```

---

## Limitations

- **Only Handles the First Question:** Always writes only the first question.
- **Basic and not production-hardened:** Intended for development, testing, or internal use and mostly for learning purposes.
- **Limited protocol support:** Only supports UDP for DNS queries (no TCP fallback).
- **No rate limiting or authentication:** The HTTP API is open by default, must be secured before exposing it to the internet.
- **No web UI:** Management is via API only.

---

## License

This project is licensed under the [MIT License](./LICENSE).

Built with ❤️ by [Owais](https://github.com/Owaisshaikh11)

<!-- icons -->

![Node](https://img.shields.io/badge/Node.js-22+-green) ![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![Redis](https://img.shields.io/badge/Redis-Enabled-red) ![Docker](https://img.shields.io/badge/Docker-Supported-blue)
