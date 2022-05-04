const { ethers } = require("hardhat");
const { Contract } = ethers;

const addressesEuler = require("@eulerxyz/euler-interfaces/addresses/addresses-mainnet.json");

const { abi: EulerAbi } = require("@eulerxyz/euler-interfaces/abis/Euler.json");
const { abi: ETokenAbi } = require("@eulerxyz/euler-interfaces/abis/modules/EToken.json");
const { abi: DTokenAbi } = require("@eulerxyz/euler-interfaces/abis/modules/DToken.json");
const { abi: MarketsAbi } = require("@eulerxyz/euler-interfaces/abis/modules/Markets.json");
const { abi: SwapAbi } = require("@eulerxyz/euler-interfaces/abis/modules/Swap.json");
const { abi: ExecAbi } = require("@eulerxyz/euler-interfaces/abis/modules/Exec.json");

const WETHabi = require("../abis/WETH.json");
const WETHaddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const DAIabi = require("../abis/DAI.json");
const DAIaddr = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

module.exports = {
  euler: new Contract(addressesEuler.euler, EulerAbi),
  markets: new Contract(addressesEuler.markets, MarketsAbi),
  swap: new Contract(addressesEuler.swap, SwapAbi),
  exec: new Contract(addressesEuler.exec, ExecAbi),
  WETH: new Contract(WETHaddr, WETHabi),
  DAI: new Contract(DAIaddr, DAIabi),
};
