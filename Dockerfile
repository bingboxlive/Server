FROM node:lts-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*
    
# Install build dependencies for native modules (wrtc)
RUN apt-get update && apt-get install -y build-essential python3 python3-pip

# Install global node dependencies to fix wrtc build
RUN npm install -g node-pre-gyp node-gyp

# Install yt-dlp via pip to include dependencies (ejs)
RUN pip3 install -U "yt-dlp[default]" --break-system-packages

WORKDIR /app

# Copy package files handling
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

CMD ["npm", "run", "dev"]
