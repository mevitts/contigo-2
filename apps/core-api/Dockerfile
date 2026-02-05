FROM node:20-slim

WORKDIR /app

COPY package.json ./
COPY pnpm-lock.yaml ./

RUN npm install -g pnpm
RUN pnpm install

COPY . ./

RUN pnpm run build

EXPOSE 3001

CMD ["pnpm", "run", "start"]
