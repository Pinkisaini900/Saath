FROM node:22
WORKDIR /app
COPY . .
RUN npm run setup
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node", "server/index.js"]
