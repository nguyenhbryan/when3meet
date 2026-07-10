FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

WORKDIR /app

COPY server.mjs ./
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/.data && chown -R node:node /app

USER node

EXPOSE 5173
VOLUME ["/app/.data"]

CMD ["node", "server.mjs"]
