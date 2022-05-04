const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;
const { MaxUint256 } = ethers.constants;
const { FeeAmount } = require("@uniswap/v3-sdk");

const {
  euler,
  markets,
  swap,
  exec,
  WETH,
  DAI,
} = require("../utils/loadContracts");
const { setBalance, impersonateAccount } = require("../utils/fork-utils");

const {
  abi: ETokenAbi,
} = require("@eulerxyz/euler-interfaces/abis/modules/EToken.json");
const {
  abi: DTokenAbi,
} = require("@eulerxyz/euler-interfaces/abis/modules/DToken.json");

const whaleWETH = "0xf584F8728B874a6a5c7A8d4d387C9aae9172D621"; // WETH whale
const whaleDAI = "0x7c8CA1a587b2c4c40fC650dB8196eE66DC9c46F4"; // DAI whale

async function prepareToken(accounts, underlyingContract, whale, amount) {
  const userAddr0 = await accounts[0].getAddress();

  // get some WETH from whale
  await setBalance(whale);

  await impersonateAccount(whale, async function (signer) {
    const tokenSinger = underlyingContract.connect(signer);

    console.log("balance before", await tokenSinger.balanceOf(userAddr0));

    await (await tokenSinger.approve(whale, MaxUint256)).wait();
    await (await tokenSinger.transferFrom(whale, userAddr0, amount)).wait();

    console.log("balance after", await tokenSinger.balanceOf(userAddr0));
  });
}

async function enterMarket(singer, underlying) {
  const marketSigner = markets.connect(singer);
  const enteredMarkets = await marketSigner.getEnteredMarkets(
    await singer.getAddress()
  );
  let entered = false;
  for (let _u of enteredMarkets) {
    if (_u === underlying) {
      entered = true;
      break;
    }
  }

  if (!entered) {
    await (await marketSigner.enterMarket(0, underlying)).wait();
  }
}

async function depositAction(singer, underlying, amount) {
  await enterMarket(singer, underlying);

  const marketSigner = markets.connect(singer);

  const ETokenAddr = await marketSigner.underlyingToEToken(underlying);
  const EToken = new ethers.Contract(ETokenAddr, ETokenAbi);

  await (await DAI.connect(singer).approve(euler.address, MaxUint256)).wait();

  await (await EToken.connect(singer).deposit(0, amount)).wait();

  console.log(
    "EToken.balanceOf",
    await EToken.connect(singer).balanceOf(await singer.getAddress())
  );

  return EToken;
}

async function shortAction(singer, shortOn, amount, against) {
  // 1. mint against EToken
  // 2. swap1inch convert against EToken to shortOn EToken

  await enterMarket(singer, shortOn);
  await enterMarket(singer, against);

  const marketSigner = markets.connect(singer);

  const ETokenShortOnAddr = await marketSigner.underlyingToEToken(shortOn);
  const ETokenAgainstAddr = await marketSigner.underlyingToEToken(against);

  const ETokenShortOn = new ethers.Contract(
    ETokenShortOnAddr,
    ETokenAbi
  ).connect(singer);
  const ETokenAgainst = new ethers.Contract(
    ETokenAgainstAddr,
    ETokenAbi
  ).connect(singer);

  await (await ETokenAgainst.mint(0, amount)).wait();
  console.log(
    "ETokenAgainst.balanceOf",
    await ETokenAgainst.balanceOf(await singer.getAddress())
  );

  await (
    await swap.connect(singer).swapUniExactInputSingle({
      subAccountIdIn: 0,
      subAccountIdOut: 0,
      underlyingIn: against,
      underlyingOut: shortOn,
      amountIn: amount,
      amountOutMinimum: 0,
      deadline: 0,
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })
  ).wait();

  console.log(
    "ETokenAgainst.balanceOf",
    await ETokenAgainst.balanceOf(await singer.getAddress())
  );
  console.log(
    "ETokenShortOn.balanceOf",
    await ETokenShortOn.balanceOf(await singer.getAddress())
  );
}

async function main() {
  const accounts = await ethers.getSigners();

  await prepareToken(accounts, DAI, whaleDAI, parseEther("100"));

  await depositAction(accounts[0], DAI.address, parseEther("100"));

  await shortAction(accounts[0], WETH.address, parseEther("100"), DAI.address);
}

main();
