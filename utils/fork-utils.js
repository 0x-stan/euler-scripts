const { ethers } = require("hardhat");
const hre = require("hardhat");

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
  setBalance,
  impersonateAccount,
};
