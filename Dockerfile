FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS go-build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
COPY frontend/embed.go frontend/embed.go
COPY --from=frontend-build /app/frontend/dist frontend/dist
RUN CGO_ENABLED=0 go build -o server .

FROM gcr.io/distroless/static-debian12
COPY --from=go-build /app/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
