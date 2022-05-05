const { ethers } = require("hardhat");
const hre = require("hardhat");

async function snapshotNetwork() {
  return await hre.network.provider.request({
    method: "evm_snapshot",
    params: [],
  });
}

async function revertNetwork(snapshot) {
  await hre.network.provider.request({
    method: "evm_revert",
    params: [snapshot],
  });
}

async function mineBlock(num = 1) {
  // console.log("mineBlock before", await ethers.provider.getBlockNumber())
  for (let i = 0; i < num; i++) {
    await hre.network.provider.request({
      method: "evm_mine",
      params: [],
    });
  }
  // console.log("mineBlock after", await ethers.provider.getBlockNumber())
  console.log(`\n${num} blocks mined...\n`)
}

async function setBalance(_account, amount = ethers.utils.parseEther("10")) {
  await hre.network.provider.send("hardhat_setBalance", [
    _account,
    amount.toHexString(),
  ]);
}

async function impersonateAccount(address, actionFunc) {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });

  const signer = await ethers.getSigner(address);

  if (actionFunc) await actionFunc(signer);

  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [address],
  });
}

module.exports = {
  snapshotNetwork,
  revertNetwork,
  mineBlock,
  setBalance,
  impersonateAccount,
};
