FROM node:14.17.1 as base

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package.json ./
COPY yarn.lock ./

# Install dependencies
RUN yarn install --production=true

# Copy source
COPY . .
COPY .env.production .env

# Build dist
RUN yarn build

ENV NODE_ENV production

# Expose port 8080
EXPOSE 8080
CMD [ "node", "dist/index.js" ]
USER node
