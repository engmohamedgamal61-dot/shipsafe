interface Order {
  total: number;
  isPriority: boolean;
  country: string;
}

/**
 * Classifies an order into a label used for fulfillment routing.
 */
export function classifyOrder(order: Order): string {
  if (order.isPriority) {
    if (order.country === "US") {
      if (order.total > 1000) {
        return "priority-high-value-us";
      } else {
        return "priority-standard-us";
      }
    } else {
      if (order.total > 1000) {
        return "priority-high-value-intl";
      } else {
        return "priority-standard-intl";
      }
    }
  } else {
    if (order.country === "US") {
      if (order.total > 1000) {
        return "standard-high-value-us";
      } else {
        return "standard-standard-us";
      }
    } else {
      if (order.total > 1000) {
        return "standard-high-value-intl";
      } else {
        return "standard-standard-intl";
      }
    }
  }
}
