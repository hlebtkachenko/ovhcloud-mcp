FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:26-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && rm -rf /root/.npm
COPY --from=build /app/dist/ ./dist/
USER node
ENTRYPOINT ["node", "dist/index.js"]
