.PHONY: all build build-client build-server run run-server run-client test clean install

ROOT_DIR := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))
BIN_DIR := $(HOME)/.local/bin
DESKTOP_DIR := $(HOME)/.local/share/applications

all: build

build: build-client build-server

build-client:
	@echo "Building client..."
	cd $(ROOT_DIR)/client && npm run build

build-server:
	@echo "Building Rust server..."
	cd $(ROOT_DIR)/server && cargo build --release

run:
	@$(ROOT_DIR)/launcher/shooter.sh

run-server:
	cd $(ROOT_DIR)/server && cargo run

run-client:
	cd $(ROOT_DIR)/client && npm run dev

test:
	@echo "Testing Rust server..."
	cd $(ROOT_DIR)/server && cargo test
	@echo "Typechecking TypeScript client..."
	cd $(ROOT_DIR)/client && npx tsc --noEmit

install: build
	@echo "Installing shooter to $(BIN_DIR)..."
	mkdir -p $(BIN_DIR) $(DESKTOP_DIR)
	install -m 755 $(ROOT_DIR)/launcher/shooter.sh $(BIN_DIR)/shooter
	install -m 644 $(ROOT_DIR)/launcher/shooter.desktop $(DESKTOP_DIR)/shooter.desktop
	@echo "Shooter installed! Run with 'shooter' or launch from your app runner."

clean:
	cd $(ROOT_DIR)/server && cargo clean
	rm -rf $(ROOT_DIR)/client/dist $(ROOT_DIR)/client/node_modules
