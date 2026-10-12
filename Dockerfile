FROM node:20-slim

# Install system fonts including Devanagari support for Nepali SVG rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-core \
    fonts-noto-extra \
    fonts-deva \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 7860
ENV PORT=7860
ENV NODE_ENV=production

CMD ["node", "server.js"]
