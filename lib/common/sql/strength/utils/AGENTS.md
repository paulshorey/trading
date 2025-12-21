# Strength Utils

Utility functions for processing strength data during database operations.

## Files

- `forwardFill.ts` - Forward-fill logic to populate missing interval values from previous rows
- `average.ts` - Calculate average of all interval columns
- `index.ts` - Re-exports from parent constants.ts and local utilities

## Intervals

**All interval definitions are centralized in `@lib/common/sql/strength/constants.ts` (parent folder).**

```typescript
import { ALL_INTERVALS, StrengthInterval, IntervalValues } from "@lib/common/sql/strength/constants";
```

## Key Concepts

### Forward-Fill

When new data arrives, some interval columns may be missing. Forward-fill looks back up to 3 previous rows to find values for missing columns. This ensures the average is always calculated with complete data.

### Average Column

The `average` column stores the mean of all interval columns. It's automatically calculated and updated whenever any interval value changes.

## Usage

These utilities are used internally by `add.ts`. They're not typically called directly from frontend code.
