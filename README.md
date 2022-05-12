# euler-scripts

## Quick Start

```sh
yarn install
```

Create `.env` file, set your alchemy_key like this:

```txt
ALCHEMY_KEY=XXXXXX
```

Or use whatever RPC service you like. Config it in `hardhat.config.js`.

Run fork-mainnet hardhat node

```sh
npx hardhat node
```

Run short action script on fork-mainnet

```sh
npx hardhat run ./script/short.js --network localhost
```
