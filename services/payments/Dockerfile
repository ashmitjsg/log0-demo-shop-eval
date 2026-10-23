FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
# keep symbols and file paths in the binary: panic stack traces name real files and lines
RUN CGO_ENABLED=0 go build -o /payments .

FROM alpine:3.21
COPY --from=build /payments /payments
ENV PORT=8092
EXPOSE 8092
USER nobody
CMD ["/payments"]
