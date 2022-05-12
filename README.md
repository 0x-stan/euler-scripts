# euler-scripts

Euler contract interactive script to simulate the interaction process of leverage shorting

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

## Short Actions

1. Deposit WETH as Collateral
2. Mint UNI with leverage, get UNI-EToken and UNI-DToken
3. Swap UNI-EToken to WETH-EToken
4. After a while, UNI's price has gone down, and we use less WETH-EToken swap UNI-EToken
5. Burn UNI-EToken and UNI-DToken
6. We have some WETH-EToken left as our profit
