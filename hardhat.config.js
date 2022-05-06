require('dotenv').config()

require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");

// Config

module.exports = {
    networks: {
        hardhat: {
            hardfork: 'berlin',
            chainId: 1,
            forking: {
                url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
                blockNumber: 14720400,
                timeout: 30*1000
            }
        },
        localhost: {
            chainId: 1,
            url: "http://127.0.0.1:8545",
            timeout: 5 * 60 * 1000, 
        },
    },

    solidity: {
        compilers: [
            {
                version: "0.8.10",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 1000000,
                    },
                    outputSelection: {
                        "contracts/Storage.sol": {
                            "*": [
                              "storageLayout",
                            ],
                        },
                    },
                },
            },
        ],
    },

    contractSizer: {
        //runOnCompile: true,
    },

    mocha: {
        timeout: 100000
    }
};

