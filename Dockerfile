# One image for api, worker, migrate and web: Node 24 runs the TypeScript directly, so there is no build step.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
RUN npm ci
COPY . .
EXPOSE 3000 5173
CMD ["npm", "run", "start", "-w", "apps/api"]
