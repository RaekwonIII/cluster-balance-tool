import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fetchClusterBalances } from '../src/clusterBalanceShared.mjs'

const require = createRequire(import.meta.url)
const { ethers } = require('ethers')

const owners = [
  '0xADa145BC7aCd9CF049b10FC3Ce3273c8Cc66a812',
  '0xC6108744c9D5db8b30f8004053a16D5683cD3489',
  '0x1EC3Cbe8fb1D8019092500CcA2111C158a35bC82',
  '0x15646dDb42Ee60B26A0BA727CFeB4E8b1A319cdE',
  '0x60cd284aDC16f5858C23B26c8377c13f72c49e35',
  '0xaBc514DEFC3C87187f714Fe11BE38Bc520fD5E8f',
  '0x45617dD06E4224d5f3aCaFf4Ef3A067C68119A89',
  '0xDfC1107db389f541F0eB2c0d1422544787B82bD2',
  '0x96c9ad3a5dF8496f9A7196E79e88682dc556FB87',
  '0x1DB131C9061e84B74b1abfc2593FDb77F330262E',
  '0x192ebd93eCb1C47F8ccAA9190F8b11151781a0cd',
  '0x7289218581702FDE4FA652C74C7ce16F2951a3D1',
  '0xB8cD60A8152ECF2030c425Cb3463efdB9810416C',
]

const rpcUrl = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com'
const contractAddress = '0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4'
const reportPath = new URL('../reports/balance-validation-report.md', import.meta.url)
const getterAbi = [
  'function getNetworkFee() view returns (uint256)',
  'function getNetworkFeeSSV() view returns (uint256)',
  'function getClusterAssetType(address owner, uint64[] operatorIds) view returns (uint8)',
  'function getBalance(address owner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (uint256)',
  'function getBalanceSSV(address owner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (uint256)',
  'function getBurnRate(address owner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (uint256)',
  'function getBurnRateSSV(address owner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (uint256)',
]

const assetTypeNames = {
  0: 'SSV',
  1: 'ETH',
}

const toContractCluster = (row) => ({
  validatorCount: Number(row.clusterSnapshot.validatorCount),
  networkFeeIndex: row.clusterSnapshot.networkFeeIndex,
  index: row.clusterSnapshot.index,
  active: row.clusterSnapshot.active,
  balance: row.clusterSnapshot.balance,
})

const uniqueOwners = [...new Set(owners)]
const strictMode = process.argv.includes('--strict')

const compareValue = (label, expected, actual) => {
  const matches = expected === actual
  return {
    label,
    expected,
    actual,
    matches,
  }
}

const main = async () => {
  const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl)
  const contract = new ethers.Contract(contractAddress, getterAbi, provider)
  const lines = []
  let totalChecks = 0
  let totalMismatches = 0
  let totalRowsWithErrors = 0

  lines.push('# Balance Validation Report')
  lines.push('')
  lines.push(`- RPC: \`${rpcUrl}\``)
  lines.push(`- SSVNetworkViews: \`${contractAddress}\``)
  lines.push(`- Owners checked: ${uniqueOwners.length}`)
  lines.push(`- Strict mode: ${strictMode ? 'enabled' : 'disabled'}`)
  lines.push('')

  let checkedDaoValues = false

  for (const owner of uniqueOwners) {
    const [result, rpcBlockNumber] = await Promise.all([
      fetchClusterBalances({ accountAddress: owner, testnet: false }),
      provider.getBlockNumber(),
    ])
    const contractBlockTag = result.currentBlockNumber ? Number(result.currentBlockNumber) : rpcBlockNumber

    lines.push(`## Owner \`${owner}\``)
    lines.push('')
    lines.push(`- Clusters found: ${result.rows.length}`)
    lines.push(`- Subgraph block: ${result.currentBlockNumber ?? 'n/a'}`)
    lines.push(`- RPC block: ${rpcBlockNumber}`)
    lines.push(`- Contract call block: ${contractBlockTag}`)
    lines.push('')

    if (!checkedDaoValues && result.daoValues) {
      const [contractNetworkFeeEth, contractNetworkFeeSsv] = await Promise.all([
        contract.getNetworkFee({ blockTag: contractBlockTag }),
        contract.getNetworkFeeSSV({ blockTag: contractBlockTag }),
      ])

      const daoChecks = [
        compareValue('networkFee ETH', result.daoValues.networkFee, contractNetworkFeeEth.toString()),
        compareValue('networkFee SSV', result.daoValues.networkFeeSSV, contractNetworkFeeSsv.toString()),
      ]

      lines.push('### DAO Cross-check')
      lines.push('')
      lines.push('| Check | Result | Expected | Actual |')
      lines.push('| --- | --- | --- | --- |')
      for (const check of daoChecks) {
        lines.push(`| ${check.label} | ${check.matches ? 'OK' : 'MISMATCH'} | \`${check.expected}\` | \`${check.actual}\` |`)
      }
      lines.push('')
      checkedDaoValues = true
    }

    lines.push('| Cluster | Asset | Check | Result | Expected | Actual | Notes |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')

    for (const row of result.rows) {
      const operatorIds = row.operatorIdsArray.map((id) => id)
      const cluster = toContractCluster(row)
      const onChainAssetType = Number(await contract.getClusterAssetType(owner, operatorIds, { blockTag: contractBlockTag }))
      const expectedAssetType = assetTypeNames[onChainAssetType] ?? `UNKNOWN(${onChainAssetType})`
      const balanceMethod = row.feeAsset === 'SSV' ? 'getBalanceSSV' : 'getBalance'
      const burnRateMethod = row.feeAsset === 'SSV' ? 'getBurnRateSSV' : 'getBurnRate'

      const [contractBalance, contractBurnRate] = await Promise.all([
        contract[balanceMethod](owner, operatorIds, cluster, { blockTag: contractBlockTag }),
        contract[burnRateMethod](owner, operatorIds, cluster, { blockTag: contractBlockTag }),
      ])

      const checks = [
        compareValue('assetType', row.feeAsset, expectedAssetType),
        compareValue('balance', row.balanceRaw, contractBalance.toString()),
        compareValue('burnRate', row.burnRateRaw, contractBurnRate.toString()),
      ]

      totalChecks += checks.length
      totalMismatches += checks.filter((check) => !check.matches).length
      if (row.rowError) {
        totalRowsWithErrors += 1
      }

      for (const check of checks) {
        lines.push(`| \`${row.operatorIds}\` | ${row.feeAsset} | ${check.label} | ${check.matches ? 'OK' : 'MISMATCH'} | \`${check.expected}\` | \`${check.actual}\` | ${row.rowError ?? ''} |`)
      }
    }

    lines.push('')
  }

  lines.splice(5, 0,
    '## Summary',
    '',
    `- Total checks: ${totalChecks}`,
    `- Mismatches: ${totalMismatches}`,
    `- Rows with runtime errors: ${totalRowsWithErrors}`,
    ''
  )

  const report = `${lines.join('\n')}\n`
  await mkdir(new URL('../reports/', import.meta.url), { recursive: true })
  await writeFile(reportPath, report, 'utf8')
  process.stdout.write(report)
  process.stdout.write(`\nSaved report to ${reportPath.pathname}\n`)

  if (strictMode && totalRowsWithErrors > 0) {
    process.exitCode = 1
    return
  }

  if (totalMismatches > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
