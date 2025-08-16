// Example usage of the new Prisma-based log functions
// This file demonstrates how to use the migrated log functionality

import { sqlLogAdd, logGets } from ".";
import type { LogRowAdd } from "./types";

// Example: Adding a log entry
export async function testLogAdd() {
  const logEntry: LogRowAdd = {
    name: "info",
    message: "Testing new Prisma-based logging",
    stack: {
      component: "test-example",
      action: "testLogAdd",
      timestamp: new Date().toISOString(),
    },
    category: "test",
    tag: "migration",
    access_key: "test-key",
  };

  await sqlLogAdd(logEntry);
  console.log("Log entry added successfully!");
}

// Example: Getting log entries
export async function testLogGet() {
  const result = await logGets({
    where: {
      category: "test",
      limit: 10,
    },
  });

  console.log("Retrieved logs:", result.rows?.length || 0, "entries");
  return result;
}

// Usage comparison:
// OLD WAY (from ./apps/data/sql/log):
// import { sqlLogAdd } from '@apps/data/sql/log/add'
// import { logGets } from '@apps/data/sql/log/gets'

// NEW WAY (from ./apps/data/log):
// import { sqlLogAdd, logGets } from '@apps/data/sql/log'
