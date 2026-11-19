# Critical-failure guard

Reference for `write-tests` and `review-tests`. Used only when a plan needs shared state across tests where a critical failure should skip the rest of the suite.

For a worker-scoped fixture whose tests share one page or context, a failed critical test should skip the rest of that suite. Decide "critical" from the test's tags (a `TestPriority.CRITICAL` tag, or a navigation / page closed / context closed error), never from its title, id or order. Write the logic once as a shared helper and create one guard per fixture file, so a critical failure in one suite does not skip another. Find or name it per `${CLAUDE_PLUGIN_ROOT}/patterns/helper-discovery.md` (reference name `createCriticalFailureGuard`, file `helpers/critical-failure-guard.ts`).

```typescript
import { test, type TestInfo } from '@playwright/test'
import { TestPriority } from '@app-types/test-metadata.types'

const PRIORITY_VALUES: readonly string[] = Object.values(TestPriority)

function isCriticalFailure(testInfo: Pick<TestInfo, 'tags' | 'errors'>): boolean {
  const priority = testInfo.tags.find((tag) => PRIORITY_VALUES.includes(tag))
  if (priority === TestPriority.CRITICAL) {
    return true
  }
  return testInfo.errors.some((error) => {
    const message = error.message ?? ''
    return message.includes('navigation') || message.includes('page closed') || message.includes('context closed')
  })
}

export interface CriticalFailureGuard {
  skipIfBlocked(): void
  record(testInfo: TestInfo): void
}

export function createCriticalFailureGuard(): CriticalFailureGuard {
  let hasCriticalFailure = false
  let failedTestName = ''

  return {
    skipIfBlocked() {
      if (hasCriticalFailure) {
        test.skip(true, `Skipped due to critical failure in: ${failedTestName}`)
      }
    },
    record(testInfo) {
      const failed = testInfo.status === 'failed' || testInfo.status === 'timedOut'
      if (failed && isCriticalFailure(testInfo)) {
        hasCriticalFailure = true
        failedTestName = testInfo.title
      }
    },
  }
}
```

Use it in each fixture file:

```typescript
const criticalFailureGuard = createCriticalFailureGuard()

export const test = uiTest.extend({
  ordersPage: async ({ page }, use, testInfo) => {
    criticalFailureGuard.skipIfBlocked()
    await use(new OrdersPage(page))
    criticalFailureGuard.record(testInfo)
  },
})
```
