FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY backend/package*.json backend/prisma.config.ts ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/data ./data
RUN mkdir -p uploads && chown -R node:node /app
ENV NODE_ENV=production PORT=4000 API_HOST=0.0.0.0
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s CMD node -e "fetch('http://127.0.0.1:4000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
