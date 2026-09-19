import { lookupDiscount } from "./discounts";

interface Cart {
  total: number;
}

/**
 * Applies a discount code to a cart and returns the updated cart.
 */
export function applyDiscountCode(cart: Cart, code: string): Cart {
  const discount = lookupDiscount(code);
  return { ...cart, total: cart.total - discount };
}
