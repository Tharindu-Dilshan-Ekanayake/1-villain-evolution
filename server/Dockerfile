# +1 Villain Evolution game backend (Colyseus + REST) for Bloxity Legion.
# Legion injects PORT, NODE_ENV, CLIENT_ORIGIN, MONGODB_URI, BLOXITY_GAME_ID, ...
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Never run as root.
USER node

# Legion sets PORT (2567); this is only the default.
ENV PORT=2567
EXPOSE 2567

# node as PID 1 receives SIGTERM directly: Colyseus then shuts down gracefully.
CMD ["node", "src/server.js"]
