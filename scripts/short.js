const { ethers } = require("hardhat");

const addressesMainnet = require("@eulerxyz/euler-interfaces/addresses/addresses-mainnet.json");
const EulerAbi = require("@eulerxyz/euler-interfaces/abis/Euler.json");
const ETokenAbi = require("@eulerxyz/euler-interfaces/abis/modules/EToken.json");
const DTokenAbi = require("@eulerxyz/euler-interfaces/abis/modules/DToken.json");
const MarketsAbi = require("@eulerxyz/euler-interfaces/abis/modules/Markets.json");
const SwapAbi = require("@eulerxyz/euler-interfaces/abis/modules/Swap.json");
const ExecAbi = require("@eulerxyz/euler-interfaces/abis/modules/Exec.json");

const WETHabi = require("../abis/WETH.json");

const { setBalance, impersonateAccount } = require("./utils/fork-utils");

// console.log(addressesMainnet);
const whale = "0xf584F8728B874a6a5c7A8d4d387C9aae9172D621";
const WETH = new ethers.Contract(
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  WETHabi
);

async function main() {
  const accounts = await ethers.getSigners();
  const userAddr0 = await accounts[0].getAddress();

  await setBalance(whale)

  console.log(
    "WETH balance before",
    await WETH.connect(accounts[0]).balanceOf(userAddr0)
  );
  console.log(
    "WETH balance before",
    (await WETH.connect(accounts[0]).balanceOf(whale)).toString()
  );

  await impersonateAccount(whale, async function (signer) {
    await (
      await WETH.connect(signer).approve(
        await signer.getAddress(),
        ethers.constants.MaxUint256
      )
    ).wait();
    await (
      await WETH.connect(signer).transferFrom(
        await signer.getAddress(),
        userAddr0,
        ethers.BigNumber.from("1000000000000")
      )
    ).wait();
  });

  console.log(
    "WETH balance after",
    await WETH.connect(accounts[0]).balanceOf(userAddr0)
  );
}

main();
