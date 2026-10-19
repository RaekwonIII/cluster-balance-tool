# Cluster Balance Tool

React app for checking SSV cluster balances and runway on:
- Ethereum mainnet
- Hoodi

The app supports mixed accounts containing both:
- ETH-paying clusters
- legacy SSV-paying clusters

## Development

Install dependencies and start the app:

```bash
npm install
npm start
```

Create a production build:

```bash
npm run build
```

## How It Works

The app queries the SSV subgraph for:
- active clusters owned by an account
- DAO fee parameters
- operator fee data

It then computes cluster balance and runway locally.

Important details:
- ETH clusters bill on vUnits, the same as the contract (`ClusterLib.sol`):
  - `vUnits = ceil(effectiveBalance * 10_000 / 32)`. If the cluster has no effective balance, `vUnits = validatorCount * 10_000`.
  - `burnRate = (networkFee + operatorFees) * vUnits / 10_000`
  - the balance calculation uses packed units (wei / 1e5). It floors the operator part and the network part separately, then multiplies by 1e5. A result below zero becomes zero.
- legacy SSV clusters use `validatorCount`
- calculations use `BigInt`
- contract validation is done against `SSVNetworkViews` on mainnet

The shared calculation logic lives in:

```text
src/clusterBalanceShared.mjs
```

The UI component is:

```text
src/SSVClusterBalanceFetcher.js
```

## Validation Script

The repository includes a regression-check script that compares the app's calculations with `SSVNetworkViews`:

```bash
npm run validate:balances
```

This script:
- fetches sample owner clusters from the subgraph
- pins contract calls to the subgraph `_meta.block.number`
- compares `assetType`, `balance`, and `burnRate`
- writes a Markdown report to `reports/balance-validation-report.md`

If any mismatch is found, the script exits with a non-zero status.

### Strict Mode

You can also fail on runtime row errors, not just mismatches:

```bash
npm run validate:balances -- --strict
```

Use this when you want the script to behave like a stronger regression gate.

### RPC Override

By default the script uses:

```text
https://ethereum-rpc.publicnode.com
```

You can override it with:

```bash
ETH_RPC_URL=https://your-rpc.example npm run validate:balances
```

## Generated Reports

Validation reports are written to `reports/` for local inspection.

That directory is intentionally gitignored because report contents change with live chain state and should not create repository churn.
