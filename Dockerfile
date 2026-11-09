# Container image for MCP catalogs that run stdio servers in Docker.
# Usage: docker run -i --rm -e SYNAPCORES_URL=http://host.docker.internal:8080 -e SYNAPCORES_API_KEY synapcores/mcp
FROM node:22-alpine
WORKDIR /app
COPY package.json LICENSE README.md ./
COPY bin ./bin
COPY src ./src
USER node
ENTRYPOINT ["node", "/app/bin/synapcores-mcp.js"]
