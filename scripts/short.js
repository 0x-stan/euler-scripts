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
  mineBlock,
} = require("../utils/fork-utils");
const {
  hugeSwapToChangePrice,
  checkSwapPrice,
} = require("../utils/uniswap-utils");

const {
  abi: ETokenAbi,
} = require("@eulerxyz/euler-interfaces/abis/modules/EToken.json");
const {
  abi: DTokenAbi,
} = require("@eulerxyz/euler-interfaces/abis/modules/DToken.json");

const CONFIG_FACTOR_SCALE = ethers.BigNumber.from("4000000000");
const ONE = parseEther("1");

const WHALES = {
  WETH: "0xf584F8728B874a6a5c7A8d4d387C9aae9172D621",
  USDC: "0x7d812B62Dc15e6F4073ebA8a2bA8Db19c4E40704",
  DAI: "0x7c8CA1a587b2c4c40fC650dB8196eE66DC9c46F4",
  UNI: "0x50796bA0F82EeF414d7b609BbDD8a5c9a785e77d",
};
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

  async prepareToken(whale, token = this.tokenAgainst) {
    await setBalance(whale);
    const userAddr = this.userAddr;
    const amount = this.principalAmount;

    await impersonateAccount(whale, async function (signer) {
      const tokenSinger = token.connect(signer);
      await (await tokenSinger.approve(whale, MaxUint256)).wait();
      await (await tokenSinger.transferFrom(whale, userAddr, amount)).wait();

      console.log(
        "\nprepare token ",
        (await tokenSinger.balanceOf(userAddr)).toString()
      );
    });
  }

  async depositAction(symbol = "against") {
    let token, EToken;
    if (symbol === "against") {
      token = this.tokenAgainst;
      EToken = this.ETokenAgainst;
    } else {
      token = this.tokenShortOn;
      EToken = this.ETokenShortOn;
    }
    await (await token.approve(euler.address, MaxUint256)).wait();

    await (await EToken.deposit(0, this.principalAmount)).wait();

    console.log(
      "\ndeposit get EToken ",
      (await EToken.balanceOf(this.userAddr)).toString()
    );
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
    console.log("leverage", leverage / 10000);

    const { collateralValue } = await this.checkAssetsValue();
    const { borrowFactor } =
      await this.marketSigner.underlyingToAssetConfigUnresolved(
        this.tokenShortOn.address
      );
    console.log("borrowFactor shoron", borrowFactor)
    console.log("borrowFactor against", (await this.marketSigner.underlyingToAssetConfigUnresolved(
      this.tokenAgainst.address
    )).borrowFactor)

    const priceShortOn = await this.checkPrice(this.tokenShortOn, true);
    let mintAmount = collateralValue
      .mul(ONE)
      .mul(leverage)
      .div(priceShortOn)
      .mul(borrowFactor)
      .div(CONFIG_FACTOR_SCALE)
      .div(10000);

    console.log("mintAmount", mintAmount / 1e18);

    console.log("\nbefore mint");
    this.checkLiquidity(true);

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
            amountIn: mintAmount.sub(parseEther("10")),
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
    // 1. swap Againgst-EToken to ShortOn-EToken
    // 2. burn shortOn EToken and DToken

    // batchDispatch with deferLiquidityChecks
    let amount = await this.ETokenAgainst.balanceOfUnderlying(this.userAddr);
    // let amount = await this.DTokenShortOn.balanceOf(this.userAddr);
    console.log("swap amount", amount);

    this.checkLiquidity(true);

    let batchIterms = [
      // swap Againgst-EToken to ShortOn-EToken
      {
        allowError: false,
        proxyAddr: swap.address,
        data: swap.interface.encodeFunctionData("swapUniExactInputSingle", [
          {
            subAccountIdIn: 0,
            subAccountIdOut: 0,
            underlyingIn: this.tokenAgainst.address,
            underlyingOut: this.tokenShortOn.address,
            amountIn: amount,
            amountOutMinimum: 0,
            deadline: 0,
            fee: 3000,
            sqrtPriceLimitX96: 0,
          },
        ]),
      },
      // burn ShortOn-EToken and ShortOn-DToken
      {
        allowError: false,
        proxyAddr: this.ETokenShortOnAddr,
        data: this.ETokenShortOn.interface.encodeFunctionData("burn", [
          0,
          MaxUint256,
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
    const res = await this.execSinger.getPriceFull(underlying.address);
    const symbol = await underlying.connect(this.user).symbol();
    if (log)
      console.log(
        `${symbol} twap: ${res[0] / 1e18} curPrice: ${res[2] / 1e18} price2: ${ONE.mul(ONE).div(res[0])  / 1e18}`
      );
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
    const priceShortOn = await this.checkPrice(this.tokenShortOn, false);
    const priceAgainst = await this.checkPrice(this.tokenAgainst, false);

    let DTokenShortOnValue = await this.DTokenShortOn.balanceOf(this.userAddr);
    let DTokenAgainstValue = await this.DTokenAgainst.balanceOf(this.userAddr);
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

    const tokenShortOnValue = BalanceShortOn.mul(priceShortOn).div(ONE);
    const tokenAgainstValue = BalanceAgainst.mul(priceAgainst).div(ONE);

    const totalValue = tokenShortOnValue
      .add(tokenAgainstValue)
      .sub(DTokenShortOnValue.mul(priceShortOn).div(ONE))
      .sub(DTokenAgainstValue.mul(priceAgainst).div(ONE));

    const healthScore = liabilityValue.gt(ethers.BigNumber.from(0))
      ? collateralValue.mul(ONE).div(liabilityValue) / 1e18
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
    await shortTrader.prepareToken(WHALES["WETH"], shortTrader.tokenAgainst);

    await shortTrader.enterMarket(shortTrader.tokenShortOn);
    await shortTrader.enterMarket(shortTrader.tokenAgainst);

    await shortTrader.depositAction("against");

    await shortTrader.checkAssetsValue(true);

    // leverage base = 10000
    const leverage = 40000;   // max leverage is 3.001 (?)
    await shortTrader.openShort(leverage);

    console.log("open short position swap price", await checkSwapPrice());

    const { totalValue } = await shortTrader.checkAssetsValue(true);

    const priceBefore = await shortTrader.checkPrice(
      shortTrader.tokenShortOn,
      true
    );

    await hugeSwapToChangePrice(
      WHALES["UNI"],
      shortTrader.tokenShortOn,
      shortTrader.tokenAgainst,
      parseEther("80000"),
      600,
      1
    );

    // await shortTrader.checkAssetsValue(true);

    // await shortTrader.checkPrice(shortTrader.tokenShortOn, true);

    // console.log(
    //   `\nprofit ${
    //     ((await shortTrader.checkAssetsValue(true)).totalValue
    //       .mul(ONE)
    //       .div(totalValue) /
    //       1e18 -
    //       1) *
    //     100
    //   }%`
    // );

    // await shortTrader.closeShort();
    // console.log("close short position swap price", await checkSwapPrice());

    const priceAfter = await shortTrader.checkPrice(
      shortTrader.tokenShortOn,
      true
    );
    const totalValueAfter = (await shortTrader.checkAssetsValue(true))
      .totalValue;
    const priceDiff = priceBefore.sub(priceAfter);

    console.log(
      `price changed ${(priceDiff.mul(ONE).div(priceBefore) / 1e18) * 100}%`
    );

    let profitPersent = totalValueAfter.mul(ONE).div(totalValue);
    console.log(`\nprofit ${(profitPersent / 1e18 - 1) * 100}%`);
  } catch (error) {
    console.error(error);
    await revertNetwork(snapshot);
    process.exit(0);
  }

  await revertNetwork(snapshot);
}

main();
