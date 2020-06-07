# cdkcommon

Common CDK

## Quickstart

```bash
make utest
```

## Build

Using makefile

```bash
make build
make lint
make utest
```

Using npm

```bash
npm install
npm run build
npm run test
npm run test:cov
# etc.
```

## Develop (watch)

Run in watch mode under nodemon (ts-node):

```bash
npm install -g pino-pretty
make develop
```

## Lambda

Package to `./lambda` with production dependencies only:

```bash
make lambda
```
