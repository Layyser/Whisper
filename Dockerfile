# Build stage
FROM golang:1.23 AS builder

WORKDIR /app

# Copy Go module files and tidy dependencies
COPY go.mod go.sum ./
RUN go mod tidy

# Copy the rest of the project
COPY . .

# Build the binary exactly as you do locally
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o whisper .

# Final minimal image
FROM alpine:3.19
WORKDIR /app

# Copy binary
COPY --from=builder /app/whisper .
COPY frontend ./frontend


EXPOSE 8080

CMD ["./whisper"]
