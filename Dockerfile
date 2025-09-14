FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

#ARG NODE_ENV="production"
#ENV NODE_ENV="${NODE_ENV}" \
#    USER="node"

COPY . .

RUN mkdir -p uploads/models

#RUN if [ "${NODE_ENV}" != "development" ]; then \
#    SCRIPT="start"; \
#    else \
#    SCRIPT="dev"; \
#    fi

#EXPOSE ${PORT}

CMD ["npm", "start"]