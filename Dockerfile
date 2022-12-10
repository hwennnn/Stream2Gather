FROM node:14.17.1 as base

# Add package file
COPY package*.json ./

# Install dependencies
RUN npm install --only production

# Copy source
COPY src ./src
COPY tsconfig.json ./tsconfig.json

# Build dist
RUN npm run build

# Expose port 8080
EXPOSE 8080
CMD npm run prod
