# Polygon Self Staked POL

This strategy calculates the voting power based on the active stake of delegators in the Polygon network.

## Overview

The strategy fetches the list of delegators from the Polygon Staking API, then calculates their voting power based on their staked amounts across all active validators. It uses the NFT counter to determine the number of validators and checks each validator's status before including their delegators' stakes in the voting power calculation.

## Parameters

- `stakeManagerAddress`: The address of the StakeManager contract
- `decimals`: The number of decimals used for token amounts (18)

## Examples

Here is an example of parameters:

```json
{
  "stakeManagerAddress": "0x5e3Ef299fDDf15eAa0432E6e66473ace8c13D908",
  "decimals": 18
}