.PHONY: all run dev build test clean

ROOT_DIR := $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))/..

all: build

build:
	npm run build

dev:
	npm run dev

run:
	@$(ROOT_DIR)/launcher/shooter.sh

test:
	npx tsc --noEmit && node --test src/physics/vehicle.test.ts src/physics/input.test.ts src/render3d/render3d.test.ts tests/regression.test.ts

clean:
	rm -rf dist node_modules
