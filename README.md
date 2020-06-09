# cdkcommon

Common CDK constructs and utils

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

## Developing

In this directory:

```bash
npm link
```

In project using this library:

```bash
npm link @liammurray/cdk-common
```

For now run `npm run build` every time you make a code change in this directory.

TODO: add watch

## Snapshot tesing

Update snapshot using `run snapshot`

```bash
npm run snapshot
npm test
```
