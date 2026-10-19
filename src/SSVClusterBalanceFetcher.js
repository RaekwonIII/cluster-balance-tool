import React, { useState } from 'react';
import { Switch } from "@headlessui/react";
import { fetchClusterBalances, formatRunwayDays } from './clusterBalanceShared.mjs';

const SSVClusterBalanceFetcher = () => {
  const [clusterArray, setClusterArray] = useState([]);
  const [tableFull, setTableFull] = useState(false)
  const [loading, setLoading] = useState(false);
  const [testnet, setTestnet] = useState(false)
  const [error, setError] = useState(null);

  const fetchData = async (accountAddress) => {
    if (!accountAddress.trim()) {
      setClusterArray([])
      setTableFull(false)
      setLoading(false)
      setError(null)
      return
    }

    setClusterArray([])
    setTableFull(false)
    setLoading(true);
    setError(null);

    try {
      const { rows } = await fetchClusterBalances({ accountAddress, testnet })
      setClusterArray(rows)
      setTableFull(true)
    } catch (fetchError) {
      console.error("Error fetching data:", fetchError);
      setError(fetchError instanceof Error ? fetchError.message : "An error occurred while fetching data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="fixed top-3 right-5">
        <a href="https://github.com/taylorferran/cluster-balance-tool" target="_blank" rel="noreferrer">
          <img
            src="github-mark-white.svg"
            alt="GitHub Logo"
            className="h-8"
          />
        </a>
      </div>
      <div className="flex justify-center items-center min-h-screen bg-[#0E0E52]">
        <div className="bg-[#0E0E52] shadow-md rounded-lg p-8 w-full max-w-md">
          <div className="flex justify-center mb-6">
            <img src="https://app.ssv.network/images/logo/light.svg" alt="SSV Network Logo" className="h-10 w-auto" />
          </div>

          <h2 className="text-3xl font-bold text-center mb-6 text-white">Cluster Balance Check</h2>

          <div className="flex justify-center items-center my-6 mx-5">
            <span className="text-white font-medium mr-4">Mainnet</span>
            <Switch
              checked={testnet}
              onChange={setTestnet}
              className={`${testnet ? 'bg-blue-600' : 'bg-blue-600'}
          relative inline-flex h-[21px] w-[45px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75`}
            >
              <span
                aria-hidden="true"
                className={`${testnet ? 'translate-x-6' : 'translate-x-0'}
            pointer-events-none inline-block h-[17px] w-[17px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out`}
              />
            </Switch>
            <span className="text-white font-medium ml-4">Hoodi</span>
          </div>

          <div className="flex justify-center mb-4">
            <input
              onChange={(event) => fetchData(event.target.value)}
              placeholder="Paste Account Address..."
              className="w-[300px] px-4 py-2 border border-gray-500 rounded-lg bg-[#0E0E52] text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div className="flex justify-center items-center">
            {loading && (
              <div className="flex justify-center items-center space-x-2">
                <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent border-solid rounded-full animate-spin"></div>
                <span className="text-blue-400 font-medium">Fetching balances...</span>
              </div>
            )}
          </div>

          {tableFull !== false && (
            <div className="w-full overflow-visible">
              <div className="mx-auto max-w-full">
                <table className="w-full bg-[#0E0E52] table-auto text-center">
                  <thead>
                    <tr className="bg-[#0E0E52] text-white">
                      <th className="px-4 py-2 whitespace-nowrap">Operator IDs</th>
                      <th className="px-4 py-2 whitespace-nowrap">Fee Asset</th>
                      <th className="px-4 py-2 whitespace-nowrap">Cluster Balance</th>
                      <th className="px-4 py-2 whitespace-nowrap">Runway</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clusterArray.map((cluster, index) => (
                      <tr key={index} className={cluster.rowError ? 'text-red-300' : 'text-white'}>
                        <td
                          className="px-4 py-2"
                          style={{
                            wordBreak: 'break-word',
                            maxWidth: '200px',
                            textAlign: 'center',
                          }}
                        >
                          {cluster.operatorIds}
                        </td>
                        <td className="px-4 py-2">
                          {cluster.feeAsset}
                        </td>
                        <td className="px-4 py-2 break-words">{cluster.balance} {cluster.currency}</td>
                        <td className="px-4 py-2">
                          {cluster.rowError ? cluster.rowError : cluster.rowNote ?? `${formatRunwayDays(cluster.runwayBlocks)} days (${cluster.runwayBlocks} blocks)`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="text-red-500 text-center mb-2">{error}</p>}

        </div>
      </div>
    </div>

  );
};

export default SSVClusterBalanceFetcher;
