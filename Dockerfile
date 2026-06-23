FROM node:20-alpine

WORKDIR /app

# Copy dependency definitions
COPY package.json /app/

# Install dependencies
RUN npm install

# Copy source and config
COPY tsconfig.json /app/
COPY src /app/src
COPY static /app/static

# Build typescript
RUN npm run build

EXPOSE 8000

CMD ["npm", "start"]
