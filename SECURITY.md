# Security policy

## Supported versions

Security fixes go into the latest `1.x` release of `@synapcores/mcp`. Please upgrade before reporting an issue you see on an older version.

## Reporting a vulnerability

Please report vulnerabilities privately rather than in a public issue:

- GitHub: **Security → Report a vulnerability** on this repository, or
- email **support@synapcores.com** with "security" in the subject.

Include the version, how you run the server (stdio client, Docker, Glama), and the steps to reproduce. We'll confirm receipt, keep you updated while we work on a fix, and credit you in the release notes if you'd like.

## Scope notes

- The server is a stdio bridge to your own SynapCores engine. Credentials (`SYNAPCORES_API_KEY`, or username and password) stay in the process environment and are only sent to the `SYNAPCORES_URL` you configure.
- Use a read-only API key when an assistant only needs to read and search; the engine then refuses SQL writes, DDL and Cypher writes.
