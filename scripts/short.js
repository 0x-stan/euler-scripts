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
  USDC,
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

const whaleWETH = "0xf584F8728B874a6a5c7A8d4d387C9aae9172D621"; // WETH whale
const whaleUSDC = "0x7d812B62Dc15e6F4073ebA8a2bA8Db19c4E40704"; // DAI whale
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

  async installSinger() {
    this.marketSigner = markets.connect(this.user);
    this.tokenShortOn = this.tokenShortOn.connect(this.user);
    this.tokenAgainst = this.tokenAgainst.connect(this.user);
    this.ETokenShortOnAddr = await this.marketSigner.underlyingToEToken(
      this.tokenShortOn.address
    );
    this.DTokenShortOnAddr = await this.marketSigner.underlyingToDToken(
      this.tokenShortOn.address
    );
    this.ETokenAgainstAddr = await this.marketSigner.underlyingToEToken(
      this.tokenAgainst.address
    );
    this.DTokenAgainstAddr = await this.marketSigner.underlyingToDToken(
      this.tokenAgainst.address
    );
    this.ETokenShortOn = new ethers.Contract(
      this.ETokenShortOnAddr,
      ETokenAbi
    ).connect(this.user);
    this.ETokenAgainst = new ethers.Contract(
      this.ETokenAgainstAddr,
      ETokenAbi
    ).connect(this.user);
    this.DTokenShortOn = new ethers.Contract(
      this.DTokenShortOnAddr,
      DTokenAbi
    ).connect(this.user);
    this.DTokenAgainst = new ethers.Contract(
      this.DTokenAgainstAddr,
      DTokenAbi
    ).connect(this.user);
    this.execSinger = exec.connect(this.user);
  }

  async prepareToken(whale) {
    await setBalance(whale);
    const userAddr = this.userAddr;
    const tokenAgainst = this.tokenAgainst;
    const amount = this.principalAmount;

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

  async depositAction() {
    await this.enterMarket(this.tokenAgainst);

    await (await this.tokenAgainst.approve(euler.address, MaxUint256)).wait();

    await (await this.ETokenAgainst.deposit(0, this.principalAmount)).wait();

    console.log(
      "\ndeposit get EToken ",
      (
        await this.ETokenAgainst.connect(this.user).balanceOf(this.userAddr)
      ).toString()
    );

    return this.ETokenAgainst;
  }

  async enterMarket(underlying) {
    const enteredMarkets = await this.marketSigner.getEnteredMarkets(
      this.userAddr
    );
    let entered = false;
    for (let _u of enteredMarkets) {
      if (_u === underlying.address) {
        entered = true;
        break;
      }
    }

    if (!entered) {
      await (await this.marketSigner.enterMarket(0, underlying.address)).wait();
    }
  }

  async openShort(leverage) {
    // 1. mint shortOn assets, get EToken and DToken of shortOn
    // 2. swap shortOn EToken to against EToken
    console.log("leverage", leverage);

    const { collateralValue } = await this.checkAssetsValue();
    const { borrowFactor } =
      await this.marketSigner.underlyingToAssetConfigUnresolved(
        this.tokenShortOn.address
      );
    const priceShortOn = await this.checkPrice(this.tokenShortOn);
    let mintAmount = collateralValue
      .mul(parseEther("1"))
      .mul(leverage)
      .div(priceShortOn)
      .mul(borrowFactor)
      .div("4000000000");

    // mintAmount = parseEther('10')

    console.log("mintAmount", mintAmount / 1e18);

    console.log("\nbefore mint");
    this.checkLiquidity(true);

    await this.enterMarket(this.tokenShortOn);
    await this.enterMarket(this.tokenAgainst);

    // batchDispatch with deferLiquidityChecks
    let batchIterms = [
      // mint ShortOn-EToken
      {
        allowError: false,
        proxyAddr: this.ETokenShortOnAddr,
        data: this.ETokenShortOn.interface.encodeFunctionData("mint", [
          0,
          mintAmount,
        ]),
      },
      // swap ShortOn-EToken to Against-EToken
      {
        allowError: false,
        proxyAddr: swap.address,
        data: swap.interface.encodeFunctionData("swapUniExactInputSingle", [
          {
            subAccountIdIn: 0,
            subAccountIdOut: 0,
            underlyingIn: this.tokenShortOn.address,
            underlyingOut: this.tokenAgainst.address,
            amountIn: MaxUint256,
            amountOutMinimum: 0,
            deadline: 0,
            fee: 3000,
            sqrtPriceLimitX96: 0,
          },
        ]),
      },
    ];
    await (
      await this.execSinger.batchDispatch(batchIterms, [this.userAddr])
    ).wait();

    console.log("\nafter mint");
    // this.checkLiquidity(true);
  }

  async closeShort() {
    // 1. swap against EToken to shortOn EToken
    // 1. burn shortOn EToken and DToken

    // batchDispatch with deferLiquidityChecks
    const amountOut = await this.DTokenShortOn.balanceOf(this.userAddr);
    console.log("amountOut", amountOut);
    let batchIterms = [
      // swap Againgst-EToken to ShortOn-EToken
      {
        allowError: false,
        proxyAddr: swap.address,
        data: swap.interface.encodeFunctionData("swapUniExactOutputSingle", [
          {
            subAccountIdIn: 0,
            subAccountIdOut: 0,
            underlyingIn: this.tokenAgainst.address,
            underlyingOut: this.tokenShortOn.address,
            amountOut: amountOut.mul(1000).div(997),
            amountInMaximum: MaxUint256,
            deadline: 0,
            fee: 3000,
            sqrtPriceLimitX96: 0,
          },
        ]),
      },
      // burn UNI-EToken and UNI-DToken
      {
        allowError: false,
        proxyAddr: this.ETokenShortOnAddr,
        data: this.ETokenShortOn.interface.encodeFunctionData("burn", [
          0,
          amountOut,
        ]),
      },
    ];
    await (
      await this.execSinger.batchDispatch(batchIterms, [this.userAddr])
    ).wait();

    console.log("\nafter burn");
    this.checkLiquidity(true);
  }

  async checkPrice(underlying, log = false) {
    const res = await exec.connect(this.user).getPrice(underlying.address);
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

    let DTokenShortOnValue = (await this.DTokenShortOn.balanceOf(this.userAddr))
      .mul(tokenShortOnPrice)
      .div(parseEther("1"));
    let DTokenAgainstValue = (await this.DTokenAgainst.balanceOf(this.userAddr))
      .mul(tokenAgainstPrice)
      .div(parseEther("1"));

    let BalanceShortOn = await this.ETokenShortOn.balanceOfUnderlying(
      this.userAddr
    );
    BalanceShortOn = BalanceShortOn.add(
      await this.tokenShortOn.balanceOf(this.userAddr)
    );

    let BalanceAgainst = await this.ETokenAgainst.balanceOfUnderlying(
      this.userAddr
    );
    BalanceAgainst = BalanceAgainst.add(
      await this.tokenAgainst.balanceOf(this.userAddr)
    );

    const tokenShortOnValue = BalanceShortOn.mul(tokenShortOnPrice).div(
      parseEther("1")
    );
    const tokenAgainstValue = BalanceAgainst.mul(tokenAgainstPrice).div(
      parseEther("1")
    );

    const totalValue = tokenShortOnValue
      .add(tokenAgainstValue)
      .sub(DTokenShortOnValue)
      .sub(DTokenAgainstValue);

    const healthScore = liabilityValue.gt(ethers.BigNumber.from(0))
      ? collateralValue.mul(parseEther("1")).div(liabilityValue) / 1e18
      : "max";

    if (log)
      console.log({
        BalanceShortOn,
        DTokenShortOnValue,
        tokenShortOnValue,
        BalanceAgainst,
        DTokenAgainstValue,
        tokenAgainstValue,
        collateralValue,
        liabilityValue,
        totalValue,
        healthScore,
      });

    return {
      collateralValue,
      liabilityValue,
      tokenShortOnValue,
      tokenAgainstValue,
      totalValue,
      healthScore,
    };
  }
}

async function main() {
  const snapshot = await snapshotNetwork();

  const accounts = await ethers.getSigners();

  const principalAmount = parseEther("0.1");

  const shortTrader = new Trader(
    accounts[0],
    await accounts[0].getAddress(),
    principalAmount,
    UNI,
    WETH
  );
  await shortTrader.installSinger();

  try {
    await shortTrader.prepareToken(whaleWETH);

    await shortTrader.depositAction();

    // Now the user tries to mint an amount X of ShortOn assset.
    // Since the self-collateralisation factor is 0.95, then X * .95 of this mint is self-collateralised.
    // The remaining 5% is a regular borrow that is adjusted up by the BF of 0.6:
    //     liability = X * (1 - 0.95) / 0.6
    // Using a risk-adjusted value of 0.375, we can solve for the maximum allowable X:
    //     0.375 = X * (1 - 0.95) / 0.6
    //     X = 4.5

    const leverage = 3;
    await shortTrader.openShort(leverage);

    const { totalValue } = await shortTrader.checkAssetsValue(true);

    const priceBefore = await shortTrader.checkPrice(
      shortTrader.tokenShortOn,
      true
    );

    await hugeSwapToChangePrice(
      whaleUNI,
      shortTrader.tokenShortOn,
      WETH,
      parseEther("500000"),
      100,
      1
    );

    const priceAfter = await shortTrader.checkPrice(
      shortTrader.tokenShortOn,
      true
    );

    console.log(
      `price changed ${
        priceBefore.sub(priceAfter).mul(parseEther("100")).div(priceBefore) /
        1e18
      }%`
    );
    await shortTrader.checkAssetsValue(true);

    // await shortTrader.closeShort();

    const profitPersent = (await shortTrader.checkAssetsValue(true)).totalValue
      .mul(parseEther("1"))
      .div(totalValue);

    console.log(`\nprofit ${(profitPersent / 1e18 - 1) * 100}%`);
  } catch (error) {
    console.error(error);
    await revertNetwork(snapshot);
  }

  await revertNetwork(snapshot);
}

main();
