FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

ENV DATA_DIR=/app/data
ENV PORT=8080
EXPOSE 8080

CMD ["bash", "bin/start.sh"]
