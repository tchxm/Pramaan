FROM mcr.microsoft.com/playwright:v1.46.0-jammy AS base
WORKDIR /app

COPY . .

RUN npm ci

RUN npm run build --workspace=packages/core \
 && npm run build --workspace=packages/agent \
 && npm run build --workspace=packages/server

ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "packages/server/dist/app.js"]
