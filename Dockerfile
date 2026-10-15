# One image, two processes: the web app and the background worker.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Owned by the unprivileged user so Next.js can write its runtime cache.
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
# Web:    npm start          Worker: npm run worker       Migrations: npm run db:migrate
CMD ["npm", "start"]
