# 🔭 DNS Observatory — Bruno API Testing Collection

This directory contains the official **Bruno API Collection** for the DNS Observatory project. It allows you to quickly inspect, test, and run automated assertions against the backend REST API endpoints.

---

## 📂 Collection Structure

* **`bruno.json`**: Root configuration specifying the collection name and type.
* **`environments/`**:
  * **`Local.bru`**: Pre-configured environment mapping the `baseUrl` variable to `http://localhost:4000`.
* **Requests (`.bru`)**:
  1. **`Iterative DNS Trace`**: Resolves domains iteratively (from Root down to Auth) and asserts successful status, RTT measurements, and parsed DNSSEC markers.
  2. **`DNS Latency Benchmark`**: Compares latency between Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`) and asserts the output schema.
  3. **`Iterative DNS Trace - Invalid Domain`**: Verifies validation error responses for malformed domain names.
  4. **`Iterative DNS Trace - Invalid Record Type`**: Verifies validation error responses for unsupported query record types.
  5. **`DNS Latency Benchmark - Missing Domain`**: Verifies validation error responses for missing required body payloads.

---

## 🚀 How to Use

### 1. Prerequisite: Start the Servers
Before running any API requests, ensure the backend API server and UDP DNS server are running. In your main project workspace terminal, run:
```bash
npm run dev
```
This boots:
* The Express server and WS gateway on port `4000`.
* The custom UDP DNS server on port `5354`.

### 2. Import into Bruno Client
1. Download and open the **[Bruno Desktop App](https://www.usebruno.com/)**.
2. On the home screen, click **Open Collection** (or click the top-left menu -> **Open Collection**).
3. Select the `bruno-collection` folder in this directory (`d:\Coding\DNS_visualizer\bruno-collection`).
4. The collection will appear in the sidebar with all pre-configured endpoints.

### 3. Select the Local Environment
1. In the top-right corner of the Bruno interface, open the **Environment** dropdown menu.
2. Select **Local** (this loads the `{{baseUrl}}` variable pointing to `http://localhost:4000`).

### 4. Execute and Assert
1. Open any request from the sidebar (e.g., `Iterative DNS Trace`).
2. Click the **Send** button (green arrow icon or `Ctrl + Enter`).
3. View the response JSON body in the right-hand panel.
4. Click the **Tests** or **Assertions** tab to view the automated test results (e.g., Status `200 OK`, response values, field validations).

### 5. Running Collections via CLI (Optional)
If you have the Bruno CLI installed (`npm install -g @usebruno/cli`), you can run the entire test suite from your terminal:
```bash
# Run the entire collection using the Local environment config
bru run --env Local
```
This runs all requests and prints assertion successes/failures directly to the shell, making it perfect for CI/CD pipelines!
