const { ethers } = require("hardhat");
const hre = require("hardhat");
const { mineBlock, impersonateAccount, setBalance } = require("./fork-utils");
const { FeeAmount } = require("@uniswap/v3-sdk");

const {
  abi: SWAP_ROUTER_ABI,
} = require("@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json");
const { UNI } = require("./loadContracts");
const V3_SWAP_ROUTER_ADDRESS = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const ONE = ethers.utils.parseEther("1");

async function hugeSwapToChangePrice(
  whale,
  tokenIn,
  tokenOut,
  amountIn,
  duration = 100,
  swapTimes = 4
) {
  await mineBlock(1);
  await impersonateAccount(whale, async function (signer) {
    await setBalance(whale);
    await (
      await tokenIn
        .connect(signer)
        .approve(V3_SWAP_ROUTER_ADDRESS, ethers.constants.MaxUint256)
    ).wait();
    const router = new ethers.Contract(
      V3_SWAP_ROUTER_ADDRESS,
      SWAP_ROUTER_ABI
    ).connect(signer);

    const path = ethers.utils.solidityPack(
      ["address", "uint24", "address"],
      [
        tokenIn.address,
        ethers.BigNumber.from(FeeAmount.MEDIUM),
        tokenOut.address,
      ]
    );

    // split huge bill
    const amountSplit = amountIn
      .mul(ethers.utils.parseEther("1"))
      .div(swapTimes)
      .div(ethers.utils.parseEther("1"));
    const timeInterval = Math.ceil(duration / swapTimes);
    for (let i = 0; i < swapTimes; i++) {
      const _amount = amountSplit.gt(amountIn) ? amountIn : amountSplit;
      await (
        await router.exactInput({
          path: path,
          recipient: await signer.getAddress(signer),
          deadline: Math.floor(Date.now() / 1000 + 1800),
          amountIn: _amount,
          amountOutMinimum: 0,
        })
      ).wait();
      amountIn = amountIn.sub(amountSplit);
      console.log(`hugeSwapToChangePrice exactInput ${_amount.toString()}`);
      console.log("huge swap price", await checkSwapPrice());

      await mineBlock(timeInterval);
    }
  });
  await mineBlock(600);
}

async function checkSwapPrice(provider = ethers.provider) {
  const abi = [
    "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  ];
  const uniV3Pool = new ethers.Contract(
    "0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801",   // UNI-WETH UniswapV3Pool
    abi,
    provider
  );
  const filters = uniV3Pool.filters.Swap();
  let log = await provider.getLogs(filters);

  if (log.length === 0) return 0;

  log = uniV3Pool.interface.parseLog(log[log.length - 1]);
  // console.log("sqrtPriceX96", log.args.sqrtPriceX96)
  return log.args.sqrtPriceX96.mul(log.args.sqrtPriceX96).div(ONE);
}

module.exports = {
  hugeSwapToChangePrice,
  checkSwapPrice,
};
