// Example usage of the new Prisma-based order functions
// This file demonstrates how to use the migrated order functionality

import { orderAdd, orderGets } from ".";
import type { OrderRowAdd } from "./types";

// Example: Adding an order entry
export async function testOrderAdd() {
  const orderEntry: OrderRowAdd = {
    client_id: 123,
    type: "MARKET",
    ticker: "BTC-USD",
    side: "LONG",
    amount: 1.5,
    price: 45000.0,
  };

  const result = await orderAdd(orderEntry);
  console.log("Order entry added successfully:", result);
  return result;
}

// Example: Getting order entries
export async function testOrderGet() {
  const result = await orderGets({
    where: {
      ticker: "BTC-USD",
      limit: 10,
    },
  });

  console.log("Retrieved orders:", result.rows?.length || 0, "entries");
  return result;
}

// Usage comparison:
// OLD WAY (from ./apps/data/sql/order):
// import { orderAdd } from '@apps/data/sql/order/add'
// import { orderGets } from '@apps/data/sql/order/gets'

// NEW WAY (from ./apps/data/order):
// import { orderAdd, orderGets } from '@apps/data/order'
