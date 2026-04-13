# CodeWatch AI

CodeWatch is an automated code review agent that leverages a **120B parameter Reasoning Model** to provide deep, context-aware feedback on GitHub Pull Requests. Unlike traditional linters, CodeWatch understands the logic intent, catching architectural flaws, security risks, and complex bugs before they reach production.

---

## Key Features

* **Deep Reasoning Reviews:** Uses high-capacity LLMs (GPT-OSS 120B) to provide suggestions that go beyond syntax.
* **Asynchronous Processing:** Built with a resilient task queue (BullMQ + Redis) to handle long-running AI inference without blocking the server.
* **Production Ready:** Optimized for cloud deployment with Docker, health checks, and secure environment handling.
* **Actionable Suggestions:** Provides line-by-line feedback directly within the GitHub PR conversation.

---



## Technical Architecture

* **Brain:** GPT-OSS 120B Reasoning Model for high-fidelity code analysis.
* **Server:** **Express.js (Node.js)** custom microservice architecture.
* **GitHub Integration:** **Octokit SDK** for authenticated REST API interactions and PR management.
* **Diff Parsing:** `parse-diff` for granular, line-by-line code analysis.
* **Task Queue:** **BullMQ + ioredis** for resilient, asynchronous job processing.
* **Tokenization:** `js-tiktoken` for precise context window management.
---

## Installation & Setup

### 1. Prerequisites
* **Node.js 20+** & npm
* **GitHub App** (Private Key, App ID, and Webhook Secret)
* **Upstash Redis** (TLS enabled)
* **DigitalOcean AI** Access Key

### 2. Environment Variables
Create a `.env` file in `apps/server/`:
```
PORT=3001
GITHUB_APP_ID=your_id
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..." # Paste full key as string
GITHUB_WEBHOOK_SECRET=your_secret
DO_GENAI_API_KEY=your_key
REDIS_HOST=your_upstash_host
REDIS_PORT=6379
REDIS_PASSWORD=your_upstash_password
REDIS_TLS=true
```
### 3. Running locally
```
cd apps/server
npm install

# Start the dev server
npm run dev
```
Note: To test webhooks locally, ensure you have the `proxy` script in your `package.json` (e.g., using Smee.io) and update your GitHub App settings to point to your proxy URL.
```
"proxy": "smee --url YOUR_URL --target http://localhost:3001/webhook"
```
---

