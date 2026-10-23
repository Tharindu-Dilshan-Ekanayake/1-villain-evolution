import { formatNumber } from '../state/economy'
import Icon from './Icon'

/** A villain's price: Wins, or Rebirth Points for the rebirth villains. */
export function PriceLabel({ villain }) {
  if (villain.cost.rp) {
    return (
      <>
        <Icon name="rebirth" /> {villain.cost.rp} Rebirth Point{villain.cost.rp === 1 ? '' : 's'}
      </>
    )
  }
  return (
    <>
      <Icon name="trophy" /> {formatNumber(villain.cost.wins || 0)}
    </>
  )
}

export default PriceLabel
