# Security Policy

## Reporting a Vulnerability
Please open an issue describing the problem without including sensitive details.
We'll respond with a secure channel for disclosure.

## Secret Handling
Secrets such as API keys or tokens should never be committed. Use environment variables or `.env` files which are excluded via `.gitignore`.

## Data Privacy
All job search data stays on your machine. Offline or encrypted LLM inference is encouraged for protecting personal information.

## Network Access
`fetchTextFromUrl` only permits `http` and `https` URLs and rejects localhost or private-network
hosts to reduce server-side request forgery risk.
