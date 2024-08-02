import { BigNumber } from '@ethersproject/bignumber';
import { formatUnits } from '@ethersproject/units';
import { Multicaller } from '../../utils';
import { customFetch } from '../../utils';

export const author = 'Polygon Labs';
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

  const delegators = await fetchDelegatorsFromApi(network);

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

  for (const { address } of delegators) {
    for (let i = 1; i <= validatorCount; i++) {
      const key = `${address}_${i}`;
      if (stakes[key]) {
        votingPower[address] = (votingPower[address] || BigNumber.from(0)).add(
          stakes[key][0]
        );
      }
    }
  }

  return Object.fromEntries(
    Object.entries(votingPower).map(([address, power]) => [
      address,
      parseFloat(formatUnits(power, options.decimals))
    ])
  );
}

async function fetchDelegatorsFromApi(network: string) {
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
    address: address.toLowerCase(), // sanity
    ...rest
  }));
}
