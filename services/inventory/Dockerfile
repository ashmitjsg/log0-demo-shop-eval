FROM rust:1.92-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/inventory /usr/local/bin/inventory
ENV PORT=8091 RUST_BACKTRACE=1
EXPOSE 8091
USER nobody
CMD ["inventory"]
