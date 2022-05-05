const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;
const { MaxUint256 } = ethers.constants;

const {
  euler,
  markets,
  swap,
  exec,
  WETH,
  DAI,
  UNI,
} = require("../utils/loadContracts");
const {
  snapshotNetwork,
  revertNetwork,
  setBalance,
  impersonateAccount,
} = require("../utils/fork-utils");
const { hugeSwapToChangePrice } = require("../utils/uniswap-utils");

const {
  abi: ETokenAbi,
} = require("@eulerxyz/euler-interfaces/abis/modules/EToken.json");
const {
  abi: DTokenAbi,
} = require("@eulerxyz/euler-interfaces/abis/modules/DToken.json");

// const whaleWETH = "0xf584F8728B874a6a5c7A8d4d387C9aae9172D621"; // WETH whale
const whaleDAI = "0x7c8CA1a587b2c4c40fC650dB8196eE66DC9c46F4"; // DAI whale
const whaleUNI = "0x50796bA0F82EeF414d7b609BbDD8a5c9a785e77d"; // UNI whale

class Trader {
  constructor(user, userAddr, principalAmount, tokenShortOn, tokenAgainst) {
    this.user = user;
    this.userAddr = userAddr;
    this.principalAmount = principalAmount;
    this.tokenShortOn = tokenShortOn;
    this.tokenAgainst = tokenAgainst;
  }

  async prepareToken(whale, amount) {
    await setBalance(whale);
    const userAddr = this.userAddr;
    const tokenAgainst = this.tokenAgainst;

    await impersonateAccount(whale, async function (signer) {
      const tokenSinger = tokenAgainst.connect(signer);
      await (await tokenSinger.approve(whale, MaxUint256)).wait();
      await (await tokenSinger.transferFrom(whale, userAddr, amount)).wait();

      console.log(
        "\nprepare token ",
        (await tokenSinger.balanceOf(userAddr)).toString()
      );
    });
  }

  async depositAction(underlying, amount) {
    await this.enterMarket(underlying);

    const marketSigner = markets.connect(this.user);

    const ETokenAddr = await marketSigner.underlyingToEToken(
      underlying.address
    );
    const EToken = new ethers.Contract(ETokenAddr, ETokenAbi);

    await (
      await DAI.connect(this.user).approve(euler.address, MaxUint256)
    ).wait();

    await (await EToken.connect(this.user).deposit(0, amount)).wait();

    console.log(
      "\ndeposit get EToken ",
      (await EToken.connect(this.user).balanceOf(this.userAddr)).toString()
    );

    return EToken;
  }

  async enterMarket(underlying) {
    const marketSigner = markets.connect(this.user);
    const enteredMarkets = await marketSigner.getEnteredMarkets(this.userAddr);
    let entered = false;
    for (let _u of enteredMarkets) {
      if (_u === underlying.address) {
        entered = true;
        break;
      }
    }

    if (!entered) {
      await (await marketSigner.enterMarket(0, underlying.address)).wait();
    }
  }

  async openShort(mintAmount) {
    // 1. mint shortOn assets, get EToken and DToken of shortOn
    // 2. swap shortOn EToken to against EToken

    const execSinger = exec.connect(this.user);

    console.log("\nbefore mint");
    this.checkLiquidity(true);

    await this.enterMarket(this.tokenShortOn);
    await this.enterMarket(this.tokenAgainst);

    const marketSigner = markets.connect(this.user);

    const ETokenShortOnAddr = await marketSigner.underlyingToEToken(
      this.tokenShortOn.address
    );
    const DTokenShortOnAddr = await marketSigner.underlyingToDToken(
      this.tokenShortOn.address
    );

    const ETokenShortOn = new ethers.Contract(
      ETokenShortOnAddr,
      ETokenAbi
    ).connect(this.user);

    const DTokenShortOn = new ethers.Contract(
      DTokenShortOnAddr,
      DTokenAbi
    ).connect(this.user);

    // batchDispatch with deferLiquidityChecks
    let batchIterms = [
      // mint UNI-EToken
      {
        allowError: false,
        proxyAddr: ETokenShortOnAddr,
        data: ETokenShortOn.interface.encodeFunctionData("mint", [
          0,
          mintAmount,
        ]),
      },
      // swap UNI-EToken to DAI-EToken
      {
        allowError: false,
        proxyAddr: swap.address,
        data: swap.interface.encodeFunctionData("swapUniExactInputSingle", [
          {
            subAccountIdIn: 0,
            subAccountIdOut: 0,
            underlyingIn: this.tokenShortOn.address,
            underlyingOut: this.tokenAgainst.address,
            amountIn: mintAmount,
            amountOutMinimum: 0,
            deadline: 0,
            fee: 3000,
            sqrtPriceLimitX96: 0,
          },
        ]),
      },
    ];
    await (await execSinger.batchDispatch(batchIterms, [this.userAddr])).wait();

    console.log("\nafter mint");
    this.checkLiquidity(true);
    // console.log(
    //   "ETokenShortOn.balanceOf",
    //   (await ETokenShortOn.balanceOf(this.userAddr)).toString()
    // );
    // console.log(
    //   "DTokenShortOn.balanceOf",
    //   (await DTokenShortOn.balanceOf(this.userAddr)).toString()
    // );

    // await (
    //   await swap.connect(this.user).swapUniExactInputSingle({
    //     subAccountIdIn: 0,
    //     subAccountIdOut: 0,
    //     underlyingIn: this.tokenShortOn.address,
    //     underlyingOut: this.tokenAgainst.address,
    //     amountIn: mintAmount.div(2),
    //     amountOutMinimum: 0,
    //     deadline: 0,
    //     fee: 3000,
    //     sqrtPriceLimitX96: 0,
    //   })
    // ).wait();
  }

  async checkPrice(underlying, log = false) {
    const res = await exec.connect(this.user).getPriceFull(underlying.address);
    const symbol = await underlying.connect(this.user).symbol();
    if (log) console.log(`${symbol} twap: ${res[0].toString()}`);
    return res[0];
  }

  async checkLiquidity(log = false) {
    const res = await exec.connect(this.user).liquidity(this.userAddr);
    if (log) console.log("user's liquidity", res.toString());
    return res;
  }

  async checkAssetsValue(log = false) {
    const { collateralValue, liabilityValue, numBorrows, borrowIsolated } =
      await this.checkLiquidity(false);
    const tokenShortOnPrice = await this.checkPrice(this.tokenShortOn, false);
    const tokenAgainstPrice = await this.checkPrice(this.tokenAgainst, false);
    const tokenShortOnValue = (
      await this.tokenShortOn.connect(this.user).balanceOf(this.userAddr)
    )
      .mul(tokenShortOnPrice)
      .div(parseEther("1"));
    const tokenAgainstValue = (
      await this.tokenAgainst.connect(this.user).balanceOf(this.userAddr)
    )
      .mul(tokenAgainstPrice)
      .div(parseEther("1"));

    const totalValue = collateralValue
      .sub(liabilityValue)
      .add(tokenShortOnValue)
      .add(tokenAgainstValue);

    if (log)
      console.log({
        collateralValue,
        liabilityValue,
        tokenShortOnValue,
        tokenAgainstValue,
        totalValue,
      });

    return {
      collateralValue,
      liabilityValue,
      tokenShortOnValue,
      tokenAgainstValue,
      totalValue,
    };
  }
}

async function main() {
  const snapshot = await snapshotNetwork();

  const accounts = await ethers.getSigners();

  const principalAmount = parseEther("100"); // 100 DAI

  const shortTrader = new Trader(
    accounts[0],
    await accounts[0].getAddress(),
    principalAmount,
    UNI,
    DAI
  );

  try {
    await shortTrader.prepareToken(whaleDAI, principalAmount);

    await shortTrader.depositAction(DAI, principalAmount);

    await shortTrader.checkAssetsValue(true);

    const leverage = 10;
    const priceShortOn = await shortTrader.checkPrice(UNI, true);
    const priceAgainst = await shortTrader.checkPrice(UNI, true);
    const mintAmount = principalAmount
      .mul(leverage)
      .mul(priceAgainst)
      .div(priceShortOn);
    console.log("mintAmount", mintAmount);

    await shortTrader.openShort(mintAmount);

    const priceBefore = await shortTrader.checkPrice(UNI, true);

    await hugeSwapToChangePrice(
      whaleUNI,
      UNI,
      WETH,
      parseEther("500000"),
      100,
      1
    );

    const priceAfter = await shortTrader.checkPrice(UNI, true);

    console.log(
      `price changed ${
        priceBefore.sub(priceAfter).mul(parseEther("100")).div(priceBefore) /
        1e18
      }%`
    );

    await shortTrader.checkAssetsValue(true);
  } catch (error) {
    console.error(error);
  }

  await revertNetwork(snapshot);
}

main();
