.PHONY: all run build test clean

ROOT_DIR := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))/..

all: build

build:
	cargo build --release

run:
	@$(ROOT_DIR)/launcher/shooter.sh

run-dev:
	cargo run

test:
	cargo test

clean:
	cargo clean
