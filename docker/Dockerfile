FROM node:20.20.2

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if it exists)
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Compile TypeScript to JavaScript
RUN npm run compile

# Expose the ports used by the application
EXPOSE 1883
EXPOSE 9000

# Set the entry point to run the basic server
CMD ["node", "bin/basic.js"]
