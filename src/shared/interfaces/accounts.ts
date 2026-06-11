export interface IAccount {
  id: number;
  balance?: number;
  /** spendable balance in sats, excluding inscription-bearing outputs */
  spendableBalance?: number;
  inscriptionCounter?: number;
  inscriptionBalance?: number;
  name: string;
  address?: string;
}
