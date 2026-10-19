/* global BigInt */
const secondsPerDay = 86400;
const avgBlockTime = 12;
export const blocksPerDay = BigInt(secondsPerDay / avgBlockTime);
const weiPerToken = 1000000000000000000n;
// Mirrors SSVCoreTypes.sol: BPS_DENOMINATOR and DEFAULT_EB_PER_VALIDATOR (in ETH)
const bpsDenominator = 10000n;
const ethPerValidator = 32n;

// Mirrors ClusterLib.ebToVUnits (ceiling division). Falls back to
// validatorCount * BPS_DENOMINATOR when no effective balance is set,
// like ClusterLib.getVUnits.
const getClusterVUnits = (cluster) => {
  const effectiveBalance = BigInt(cluster.effectiveBalance ?? 0);
  if (effectiveBalance === 0n) {
    return BigInt(cluster.validatorCount) * bpsDenominator;
  }

  return (effectiveBalance * bpsDenominator - 1n) / ethPerValidator + 1n;
};

const zeroFeeOperator = {
  fee: "0",
  feeIndex: "0",
  feeIndexBlockNumber: "0",
  feeSSV: "0",
  feeIndexSSV: "0",
  feeIndexBlockNumberSSV: "0",
};

export const networkConfigs = {
  mainnet: {
    url: "https://api.studio.thegraph.com/query/71118/ssv-network-ethereum/version/latest",
    daoAddress: "0xdd9bc35ae942ef0cfa76930954a156b3ff30a4e1",
  },
  hoodi: {
    url: "https://api.studio.thegraph.com/query/71118/ssv-network-hoodi/version/latest",
    daoAddress: "0x58410bef803ecd7e63b23664c586a6db72daf59c",
  },
};

const assetConfigs = {
  ETH: {
    currency: "ETH",
    scalingFactor: 100000n,
    networkFee: "networkFee",
    networkFeeIndex: "networkFeeIndex",
    networkFeeIndexBlockNumber: "networkFeeIndexBlockNumber",
    liquidationThreshold: "liquidationThreshold",
    minimumLiquidationCollateral: "minimumLiquidationCollateral",
    operatorFee: "fee",
    operatorFeeIndex: "feeIndex",
    operatorFeeIndexBlockNumber: "feeIndexBlockNumber",
    getBillingUnits: getClusterVUnits,
    billingUnitsDivisor: bpsDenominator,
    packedUsage: true,
  },
  SSV: {
    currency: "SSV",
    scalingFactor: 10000000n,
    networkFee: "networkFeeSSV",
    networkFeeIndex: "networkFeeIndexSSV",
    networkFeeIndexBlockNumber: "networkFeeIndexBlockNumberSSV",
    liquidationThreshold: "liquidationThresholdSSV",
    minimumLiquidationCollateral: "minimumLiquidationCollateralSSV",
    operatorFee: "feeSSV",
    operatorFeeIndex: "feeIndexSSV",
    operatorFeeIndexBlockNumber: "feeIndexBlockNumberSSV",
    getBillingUnits: (cluster) => BigInt(cluster.validatorCount),
    billingUnitsDivisor: 1n,
    packedUsage: false,
  },
};

const parseBigInt = (value) => BigInt(value);

export const formatTokenAmount = (value) => {
  const amount = typeof value === "bigint" ? value : parseBigInt(value);
  const sign = amount < 0n ? "-" : "";
  const absoluteValue = amount < 0n ? -amount : amount;
  const wholePart = absoluteValue / weiPerToken;
  const fractionalPart = ((absoluteValue % weiPerToken) * 1000n) / weiPerToken;

  return `${sign}${wholePart.toString()}.${fractionalPart.toString().padStart(3, "0")}`;
};

export const formatRunwayDays = (runwayBlocks) => {
  if (runwayBlocks === null || runwayBlocks === undefined) {
    return "";
  }

  return (parseBigInt(runwayBlocks) / blocksPerDay).toString();
};

const buildClusterQuery = (accountAddress, daoAddress) => `{
  _meta {
    block {
      number
    }
  }
  daovalues(id: "${daoAddress}") {
    networkFee
    networkFeeIndex
    networkFeeIndexBlockNumber
    liquidationThreshold
    minimumLiquidationCollateral
    networkFeeSSV
    networkFeeIndexSSV
    networkFeeIndexBlockNumberSSV
    liquidationThresholdSSV
    minimumLiquidationCollateralSSV
  }
  account(id: "${accountAddress}") {
    clusters(where: {active: true}) {
      operatorIds
      feeAsset
      active
      validatorCount
      effectiveBalance
      vUnits
      networkFeeIndex
      index
      balance
    }
  }
}`;

const buildOperatorQuery = (operatorIds) => `{
  operators(where: {id_in: ["${operatorIds.join('", "')}"]}) {
    id
    fee
    feeIndex
    feeIndexBlockNumber
    feeSSV
    feeIndexSSV
    feeIndexBlockNumberSSV
  }
}`;

const fetchGraphQL = async (url, query, fetchFn) => {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  if (!response.ok || data.errors?.length) {
    const errorMessage = data.errors?.[0]?.message ?? "GraphQL request failed";
    throw new Error(errorMessage);
  }

  return data.data;
};

const calculateClusterRow = ({
  cluster,
  operatorMap,
  daoValues,
  currentBlockNumber,
}) => {
  const assetConfig = assetConfigs[cluster.feeAsset];
  if (!assetConfig) {
    throw new Error(`Unsupported fee asset: ${cluster.feeAsset}`);
  }

  const operatorIdsArray = cluster.operatorIds.map((id) => id.toString());
  const validatorCount = parseBigInt(cluster.validatorCount);

  if (validatorCount === 0n) {
    return {
      feeAsset: cluster.feeAsset,
      operatorIds: operatorIdsArray.join(","),
      operatorIdsArray,
      balance: formatTokenAmount(cluster.balance),
      balanceRaw: cluster.balance,
      currency: assetConfig.currency,
      runwayBlocks: null,
      burnRateRaw: "0",
      rowError: null,
      rowNote: "Empty cluster",
      clusterSnapshot: {
        validatorCount: cluster.validatorCount,
        networkFeeIndex: cluster.networkFeeIndex,
        index: cluster.index,
        active: cluster.active,
        balance: cluster.balance,
      },
      networkFeeRaw: "0",
      liquidationThresholdRaw: "0",
      minimumLiquidationCollateralRaw: "0",
    };
  }

  const operators = operatorIdsArray.map(
    (id) => operatorMap.get(id) ?? zeroFeeOperator,
  );
  const networkFee = parseBigInt(daoValues[assetConfig.networkFee]);
  const networkFeeIndex = parseBigInt(daoValues[assetConfig.networkFeeIndex]);
  const networkFeeIndexBlockNumber = parseBigInt(
    daoValues[assetConfig.networkFeeIndexBlockNumber],
  );
  const liquidationThreshold = parseBigInt(
    daoValues[assetConfig.liquidationThreshold],
  );
  const minimumLiquidationCollateral = parseBigInt(
    daoValues[assetConfig.minimumLiquidationCollateral],
  );
  const billingUnits = assetConfig.getBillingUnits(cluster);
  const clusterNetworkFeeIndex = parseBigInt(cluster.networkFeeIndex);
  const clusterIndex = parseBigInt(cluster.index);
  const clusterBalance = parseBigInt(cluster.balance);
  const cumulativeNetworkFee =
    networkFeeIndex +
    (currentBlockNumber - networkFeeIndexBlockNumber) * networkFee -
    clusterNetworkFeeIndex * assetConfig.scalingFactor;

  let cumulativeOperatorFee = -clusterIndex * assetConfig.scalingFactor;
  for (const operator of operators) {
    cumulativeOperatorFee +=
      parseBigInt(operator[assetConfig.operatorFeeIndex]) +
      (currentBlockNumber -
        parseBigInt(operator[assetConfig.operatorFeeIndexBlockNumber])) *
        parseBigInt(operator[assetConfig.operatorFee]);
  }

  const operatorsFee = operators.reduce(
    (accumulator, currentValue) =>
      accumulator + parseBigInt(currentValue[assetConfig.operatorFee]),
    0n,
  );

  let calculatedClusterBalance;
  if (assetConfig.packedUsage) {
    // Mirrors ClusterLib.updateBalanceWithEB: work in packed units
    // (wei / scalingFactor), floor each term, then clamp at zero.
    const packedNetworkDelta = cumulativeNetworkFee / assetConfig.scalingFactor;
    const packedOperatorDelta =
      cumulativeOperatorFee / assetConfig.scalingFactor;
    const usage =
      ((packedOperatorDelta * billingUnits) / assetConfig.billingUnitsDivisor +
        (packedNetworkDelta * billingUnits) / assetConfig.billingUnitsDivisor) *
      assetConfig.scalingFactor;
    calculatedClusterBalance =
      usage > clusterBalance ? 0n : clusterBalance - usage;
  } else {
    const scaledFeeDelta = cumulativeNetworkFee + cumulativeOperatorFee;
    const scaledBalanceChange =
      (scaledFeeDelta * billingUnits) / assetConfig.billingUnitsDivisor;
    calculatedClusterBalance = clusterBalance - scaledBalanceChange;
  }
  const burnRate =
    ((operatorsFee + networkFee) * billingUnits) /
    assetConfig.billingUnitsDivisor;

  if (burnRate <= 0n) {
    return {
      feeAsset: cluster.feeAsset,
      operatorIds: operatorIdsArray.join(","),
      operatorIdsArray,
      balance: formatTokenAmount(calculatedClusterBalance),
      balanceRaw: calculatedClusterBalance.toString(),
      currency: assetConfig.currency,
      runwayBlocks: null,
      burnRateRaw: burnRate.toString(),
      rowError: `Invalid burn rate for ${cluster.feeAsset} cluster`,
      rowNote: null,
      clusterSnapshot: {
        validatorCount: cluster.validatorCount,
        networkFeeIndex: cluster.networkFeeIndex,
        index: cluster.index,
        active: cluster.active,
        balance: cluster.balance,
      },
      networkFeeRaw: networkFee.toString(),
      liquidationThresholdRaw: liquidationThreshold.toString(),
      minimumLiquidationCollateralRaw: minimumLiquidationCollateral.toString(),
    };
  }

  const liquidationCollateral =
    minimumLiquidationCollateral > burnRate * liquidationThreshold
      ? minimumLiquidationCollateral
      : burnRate * liquidationThreshold;
  const runwayBalance = calculatedClusterBalance - liquidationCollateral;
  const operationalRunway = runwayBalance / burnRate;

  return {
    feeAsset: cluster.feeAsset,
    operatorIds: operatorIdsArray.join(","),
    operatorIdsArray,
    balance: formatTokenAmount(calculatedClusterBalance),
    balanceRaw: calculatedClusterBalance.toString(),
    currency: assetConfig.currency,
    runwayBlocks: operationalRunway.toString(),
    burnRateRaw: burnRate.toString(),
    rowError: null,
    rowNote: null,
    clusterSnapshot: {
      validatorCount: cluster.validatorCount,
      networkFeeIndex: cluster.networkFeeIndex,
      index: cluster.index,
      active: cluster.active,
      balance: cluster.balance,
    },
    networkFeeRaw: networkFee.toString(),
    liquidationThresholdRaw: liquidationThreshold.toString(),
    minimumLiquidationCollateralRaw: minimumLiquidationCollateral.toString(),
  };
};

export const fetchClusterBalances = async ({
  accountAddress,
  testnet = false,
  fetchFn = fetch,
}) => {
  const normalizedAccountAddress = accountAddress.trim().toLowerCase();
  if (!normalizedAccountAddress) {
    return {
      rows: [],
      daoValues: null,
      currentBlockNumber: null,
      network: testnet ? "hoodi" : "mainnet",
    };
  }

  const network = testnet ? "hoodi" : "mainnet";
  const { url, daoAddress } = networkConfigs[network];
  const clusterData = await fetchGraphQL(
    url,
    buildClusterQuery(normalizedAccountAddress, daoAddress),
    fetchFn,
  );

  const clusters = clusterData.account?.clusters ?? [];
  const allOperatorIds = [
    ...new Set(
      clusters.flatMap((cluster) =>
        cluster.operatorIds.map((id) => id.toString()),
      ),
    ),
  ];

  let operatorMap = new Map();
  if (allOperatorIds.length > 0) {
    const operatorData = await fetchGraphQL(
      url,
      buildOperatorQuery(allOperatorIds),
      fetchFn,
    );
    operatorMap = new Map(
      operatorData.operators.map((operator) => [
        operator.id.toString(),
        operator,
      ]),
    );
  }

  const currentBlockNumber = parseBigInt(clusterData._meta.block.number);
  const rows = clusters.map((cluster) =>
    calculateClusterRow({
      cluster,
      operatorMap,
      daoValues: clusterData.daovalues,
      currentBlockNumber,
    }),
  );

  return {
    rows,
    daoValues: clusterData.daovalues,
    currentBlockNumber: currentBlockNumber.toString(),
    network,
  };
};
