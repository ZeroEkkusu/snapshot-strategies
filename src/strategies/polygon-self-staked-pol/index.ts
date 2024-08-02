import { BigNumber } from '@ethersproject/bignumber';
import { formatUnits } from '@ethersproject/units';
import { getAddress } from '@ethersproject/address';
import { Multicaller } from '../../utils';
import { customFetch } from '../../utils';
import fs from 'fs'; // debugging

export const author = 'ZeroEkkusu';
export const version = '0.1.0';

const stakeManagerABI = [
  'function getValidatorContract(uint256) view returns (address)',
  'function validators(uint256) view returns (uint256 amount, uint256 reward, uint256 activationEpoch, uint256 deactivationEpoch, uint256 jailTime, address signer, address contractAddress, uint8 status, uint256 commissionRate, uint256 lastCommissionUpdate, uint256 delegatorsReward, uint256 delegatedAmount, uint256 initialRewardPerStake)',
  'function currentEpoch() view returns (uint256)',
  'function NFTCounter() view returns (uint256)'
];

const validatorShareABI = [
  'function getTotalStake(address) view returns (uint256, uint256)'
];

const STAKING_API = {
  1: 'https://staking-api.polygon.technology/api/v2',
  11155111: 'https://staking-api-amoy.polygon.technology/api/v2'
};

interface IDelegator {
  bondedValidator: number;
  address: string;
}

export async function strategy(
  space,
  network,
  provider,
  addresses,
  options,
  snapshot
): Promise<Record<string, number>> {
  const blockTag = typeof snapshot === 'number' ? snapshot : 'latest';

  //const delegators = await fetchDelegatorsFromApi(network);
  fetchDelegatorsFromApi(network); // suppress warnings with dummy data (return [])
  const delegators: IDelegator[] = [
    {
      bondedValidator: 148,
      address: '0x1fb4374f670d6c151335d915dbaa2c3ed7d8a254'
    },
    {
      bondedValidator: 72,
      address: '0x08998f1d3c9edb7da7ca99ca4f3c4118d761f5c1'
    },
    {
      bondedValidator: 72,
      address: '0xe7e02afeb25f1ae16a3caa872845f937cf314466'
    },
    {
      bondedValidator: 94,
      address: '0xdeeddf2d1bcb7c73046f6eac5d719e991c6b1982'
    },
    {
      bondedValidator: 91,
      address: '0xdeeddf2d1bcb7c73046f6eac5d719e991c6b1982'
    }
  ];

  const multi = new Multicaller(network, provider, stakeManagerABI, {
    blockTag
  });

  multi.call('currentEpoch', options.stakeManagerAddress, 'currentEpoch');
  multi.call('nftCounter', options.stakeManagerAddress, 'NFTCounter');

  const initialResult = await multi.execute();
  const currentEpoch = initialResult.currentEpoch.toNumber();
  const nftCounter = initialResult.nftCounter.toNumber();

  const validatorCount = nftCounter;

  for (let id = 1; id <= validatorCount; id++) {
    multi.call(
      `validator${id}`,
      options.stakeManagerAddress,
      'getValidatorContract',
      [id]
    );
    multi.call(
      `validatorInfo${id}`,
      options.stakeManagerAddress,
      'validators',
      [id]
    );
  }

  const result = await multi.execute();

  const votingPower: Record<string, BigNumber> = {};
  for (const { address } of delegators) {
    votingPower[address] = BigNumber.from(0);
  }

  const stakesMulti = new Multicaller(network, provider, validatorShareABI, {
    blockTag
  });

  for (let id = 1; id <= validatorCount; id++) {
    const validatorContract = result[`validator${id}`];
    const validatorInfo = result[`validatorInfo${id}`];

    const isNotDeactivated =
      validatorInfo.deactivationEpoch.eq(0) ||
      validatorInfo.deactivationEpoch.gt(currentEpoch);

    if (
      isNotDeactivated &&
      validatorContract !== '0x0000000000000000000000000000000000000000'
    ) {
      for (const { address } of delegators.filter(
        ({ bondedValidator }) => bondedValidator === id
      )) {
        stakesMulti.call(
          `${address}_${id}`,
          validatorContract,
          'getTotalStake',
          [address]
        );
      }
    }
  }

  const stakes = await stakesMulti.execute();

  for (const { address, bondedValidator } of delegators) {
    const key = `${address}_${bondedValidator}`;
    if (stakes[key]) {
      votingPower[address] = votingPower[address].add(stakes[key][0]);
    }
  }

  const scores = Object.fromEntries(
    Object.entries(votingPower).map(([address, power]) => [
      getAddress(address),
      parseFloat(formatUnits(power, options.decimals))
    ])
  );

  // debug
  fs.writeFileSync('./result.txt', JSON.stringify(scores, null, 2), 'utf-8');

  return scores;
}

async function fetchDelegatorsFromApi(network: string) {
  return [];
  const base = STAKING_API[parseInt(network)];
  if (!base) throw new Error(`Invalid network ${network}`);
  const delegators: IDelegator[] = [],
    limit = 10_000;
  let offset = 0;
  while (true) {
    try {
      const { result, success, error } = await (
        await customFetch(
          `${base}/delegators?offset=${offset}&limit=${limit}`,
          {}
        )
      ).json();
      if (!success) throw new Error(error);
      if (result.length === 0) break;
      delegators.push(...result);
      offset++;
    } catch (e) {
      console.error(e);
      break;
    }
  }
  return delegators.map(({ address, ...rest }) => ({
    //address: address.toLowerCase(), // sanity
    address: getAddress(address),
    ...rest
  }));
}
