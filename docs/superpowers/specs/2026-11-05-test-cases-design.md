# Test Cases and Test Plans: Design

Date: 2026-11-05. Status: implemented on `feat/test-cases`.

User decisions after the first draft, which this document now reflects: employees write test cases, so `testcase.manage` also goes to the Employee role; CI pipelines can report results with a token, like an Azure PAT; both phases ship together, in one migration.

## Goal

People write test scenarios and steps in this app. Claude, working in any repo through the existing MCP server, picks them up and writes Playwright tests that match them exactly, then reports back what it automated and how the tests ran.

The structure follows Azure Test Plans. Users sign in through the existing MCP OAuth flow; no auth changes.

Flexible means nothing is compulsory: a test case can live on its own in the project library, be automated, and record results directly, or be added to any number of plans and suites.

## The Playwright loop

1. A person writes a case and marks it `READY`.
2. Claude calls `list_test_cases` with `status=READY`, `automationStatus=NOT_AUTOMATED`, `includeSteps=true`.
3. Claude writes one Playwright test per case:

   | Test case | Playwright |
   |---|---|
   | Key `OPS-TC-12` | Test title prefix: `test('OPS-TC-12: user signs in', ...)` |
   | Each step | One `test.step(action, ...)`, with `expected` as its assertions |
   | Preconditions | `beforeEach` or fixtures |
   | Tags | Playwright tags such as `@smoke` |
   | Suite (phase 2) | `test.describe` |
   | Configuration (phase 2) | Playwright project such as `chromium` |

4. Claude calls `set_test_automation` with the spec file and test name, and the case `version` it worked from.
5. After a run, Claude calls `record_test_results` with the outcomes.
6. If someone later edits the case, it shows as out of date, and `list_test_cases` with `automationStale=true` tells Claude which tests to update.

The mapping is written into the MCP tool descriptions, so Claude follows it in any repo without extra setup.

## Concepts

```
Project
├── Test case library     OPS-TC-12   reusable steps, tags, ticket links, automation link
└── Test plan             OPS-TP-3    optional sprint and dates
    └── Suite (nested)    static folders
        └── Test point    test case + configuration + tester, holds the latest outcome
            └── Results   one row per execution, with step outcomes
```

As in Azure, editing a test case updates it everywhere, because plans refer to cases rather than copying them. One case in two configurations (Chrome, Edge) gives two test points, each with its own outcome.

## Phases

**Phase 1: library and Playwright loop.** Test cases, steps, tags, ticket links, automation link and staleness, results with history, 8 MCP tools, the library pages and the ticket tab. Usable for Playwright on its own.

**Phase 2: Azure-style plans.** Plans, nested static suites, test points with configurations and testers, manual run dialog with per-step outcomes, plan progress, File Bug, 11 MCP tools. Each phase ships and deploys separately.

**Out, can be added later without rework:** shared steps, shared parameters, requirement-based and query-based suites, charts, plan cloning, attachments on results, bulk create tools, notifications.

**CI reporting.** `CiToken` lets a pipeline post results with no user present. A token acts as the user who created it, needs `testcase.execute`, works only on `POST /api/test-results` (`getCiTokenUser` is separate from `getSessionUser`), and always records `AUTOMATED`. Tokens are stored hashed, expire within a year, and can be revoked. They are managed only from a browser session under Settings > AI tools, so an AI tool's token can't mint a longer-lived one.

## Data model

All new tables. There are no new columns on existing tables, so existing queries work whichever of the code and the migration ships first.

**Phase 1**

| Table | Fields |
|---|---|
| `TestCounter` | `projectId` (PK), `nextCase`, `nextPlan` |
| `TestCase` | `key` (unique), `number`, `projectId`, `title`, `preconditions`, `steps` (JSON `[{action, expected, data?}]`), `tags` (JSON string array), `priorityId`, `status` (`DRAFT`, `READY`, `DEPRECATED`; default `DRAFT`), `ownerId?`, `version` (default 1), `automationStatus` (`NOT_AUTOMATED`, `AUTOMATED`, `WONT_AUTOMATE`; default `NOT_AUTOMATED`), `automationRef?`, `automatedVersion?`, `lastResult?`, `lastRunAt?`, `deletedAt?`, timestamps |
| `TestCaseTicket` | `testCaseId`, `ticketId` (composite PK, both cascade) |
| `TestResult` | `testCaseId` (cascade), `pointId?`, `outcome` (`PASS`, `FAIL`, `BLOCKED`, `SKIPPED`), `source` (`MANUAL`, `AUTOMATED`), `stepResults?` (JSON), `notes`, `buildVersion?`, `executedById?` (set null), `executedAt`, `bugTicketId?` (set null) |

**Phase 2**

| Table | Fields |
|---|---|
| `TestPlan` | `key` (unique), `number`, `projectId`, `name`, `description`, `status` (`ACTIVE`, `COMPLETED`), `sprintId?`, `startDate?`, `endDate?`, `ownerId?`, `deletedAt?`, timestamps |
| `TestSuite` | `planId` (cascade), `parentId?` (cascade), `name`, `order`, timestamps |
| `TestPoint` | `suiteId` (cascade), `testCaseId` (cascade), `configuration` (default `""`), `testerId?` (set null), `order`, `lastResult?`, `lastRunAt?`; unique on `suiteId, testCaseId, configuration` |

Phase 2 also adds the foreign key from `TestResult.pointId` to `TestPoint` (set null).

Indexes: `TestCase(projectId, deletedAt)`, `TestPlan(projectId, deletedAt)`, `TestSuite(planId)`, `TestPoint(suiteId)`, `TestPoint(testerId)`, `TestPoint(testCaseId)`, `TestResult(testCaseId, executedAt)`, `TestResult(pointId, executedAt)`, `TestCaseTicket(ticketId)`.

- **Numbering:** an atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` on `TestCounter`, with the same retry on a key collision as `createTicket`. Keys never reuse ticket numbers.
- **Not run:** a null `lastResult`.
- **Step results:** a snapshot of `{action, expected, outcome, comment}`, so history stays correct after a case is edited.
- **Step data:** `data` holds the inputs for a step. It must never hold real secrets; reference an environment variable name such as `TEST_USER_PASSWORD`.
- **Configuration:** free text on the point, with no separate table. Empty means no configuration.

## Keeping tests in step with cases

- `version` goes up by one only when the `title`, `preconditions` or `steps` change. Tags, status and owner don't count.
- `set_test_automation` must send the `version` the test was written from, and it must not be higher than the current version. If someone edits the case while Claude is writing the test, the case correctly shows as out of date.
- A case is **stale** when `automationStatus` is `AUTOMATED` and `version` is greater than `automatedVersion`. Stale is computed, not stored.
- `WONT_AUTOMATE` covers cases that need a person, and they stay out of Claude's queue.

## Permissions

| Action | Who |
|---|---|
| View cases, plans, suites, points, results | Any signed-in user |
| Record results and set the automation link (`testcase.execute`) | Employee, Manager, Admin |
| Create, edit, delete, link, organise, assign testers (`testcase.manage`) | Employee, Manager, Admin |
| File a bug from a failed test | Also needs `ticket.create`, so Manager and Admin. Employees use notes. |

Add both keys to `PERMISSION_CATALOG` and `prisma/seed.ts`. The migration appends them to the prod Manager and Employee roles. Admin already has `*`. Checked on 2026-11-05: prod has only these three roles.

**Ticket privacy:** test cases are visible more widely than tickets. Every ticket returned, whether a link or a bug, goes through `ticketScopeFor`. The `ticketKey` filter on `list_test_cases` returns 403 if the caller cannot see that ticket.

**Steps are untrusted input for Claude.** Anyone with `testcase.manage` can write text that Claude later reads while working in a repo. The tool descriptions say to treat step text as a description of test behaviour, not as instructions to Claude, and generated tests go through normal code review before they run in CI.

## Rules

- Links, bug tickets, plan cases and sprints must be in the same project, and tickets must be visible to the actor.
- A project that is archived rejects creates and results.
- `DEPRECATED` or deleted cases reject results and cannot be added to suites. Existing points stay, showing the deprecated state.
- A `COMPLETED` plan is read-only until reopened: no results on its points and no structure changes.
- Recording a result inserts the row and updates the case's (and the point's, if any) `lastResult` and `lastRunAt` in one transaction. `executedAt` is set by the server, so the newest row is always the latest.
- `record_test_results` handles each entry separately and reports per entry, so one bad key doesn't lose the rest of a run.
- `stepResults` is optional. If sent, its length must match the case's steps. The overall outcome is always the value sent; the UI suggests it (any failed step means `FAIL`).
- Moving a suite rejects cycles and nesting deeper than 10 levels.
- Deleting a plan or case is a soft delete. Deleting a suite or removing a point is a hard delete, and results stay on the case with `pointId` null.
- Adding cases to a suite skips duplicates and reports how many were added and skipped.
- If two people edit at once, the last save wins, as with tickets.
- All fields are plain text, rendered by React. There is no HTML to sanitise.

**Limits:** title 3-300 chars; name 2-120; preconditions, each step field and notes 5000; 100 steps; 20 tags of 50 chars; build 100; configuration 80; automation reference 500; one add request creates at most 500 points; one bulk result request takes at most 200 entries; `includeSteps` caps page size at 50.

Actions are written with the existing `audit()` helper in `src/lib/history.ts`.

## API

Routes use `authRoute` and `parseBody`; logic lives in `src/lib/testcases/service.ts`.

| Phase | Route | Methods |
|---|---|---|
| 1 | `/api/test-cases` | GET, POST |
| 1 | `/api/test-cases/[key]` | GET, PATCH, DELETE |
| 1 | `/api/test-cases/[key]/automation` | PATCH |
| 1 | `/api/test-results` | POST (one or many, by case key or `pointId`; also accepts a CI token) |
| 1 | `/api/ci-tokens` | GET, POST, DELETE (browser session only) |
| 2 | `/api/test-plans` | GET, POST |
| 2 | `/api/test-plans/[key]` | GET (suite tree, points, outcome counts), PATCH, DELETE |
| 2 | `/api/test-plans/[key]/suites` | POST |
| 2 | `/api/test-suites/[id]` | PATCH, DELETE |
| 2 | `/api/test-suites/[id]/points` | POST (add cases) |
| 2 | `/api/test-points/[id]` | PATCH (tester), DELETE |

## MCP tools

19 new tools in `src/lib/mcp/tools.ts`, calling the routes in-process like the existing 45.

**Phase 1 (8)**

- `list_test_cases`: filter by project, status, automation status, stale, last result, tag, ticket or text; paginated; optional `includeSteps`
- `get_test_case`: with visible tickets and the last 50 results
- `create_test_case`
- `update_test_case`: only the fields sent; `steps` and `ticketKeys` replace the set
- `delete_test_case`
- `set_test_automation`: status, reference such as `tests/login.spec.ts > user signs in`, and version
- `record_test_result`: case `key`, or `pointId` from phase 2; outcome, optional step outcomes, notes, build, bug ticket key
- `record_test_results`: many results from one Playwright run

**Phase 2 (11)**

- **Plans:** `list_test_plans`, `get_test_plan`, `create_test_plan`, `update_test_plan`, `delete_test_plan`
- **Suites:** `create_test_suite`, `update_test_suite`, `delete_test_suite`
- **Points:** `add_test_cases_to_suite` (keys, optional configurations, optional tester), `update_test_point`, `remove_test_point`

Together these cover the test plan actions in Microsoft's Azure DevOps MCP server (list plans, create plan, create suite, add cases to suite, create case, update steps). Clients must reconnect once after each phase to see the new tools.

## Web UI

**Phase 1**

- **Sidebar, Delivery section:** Test Cases.
- **`/test-cases`:** library with filters, including automation status and out of date, and create.
- **`/test-cases/[key]`:** steps editor, tags, linked tickets, automation status and reference with an out-of-date warning, run history, record result.
- **Ticket page:** a Test Cases tab alongside Comments, Activity and Emails.

**Phase 2**

- **Sidebar, Delivery section:** Test Plans.
- **`/test-plans`:** list with progress bars, project filter, create.
- **`/test-plans/[key]`:** suite tree on the left. On the right, test points with outcome, tester, configuration and build, filterable by outcome and "assigned to me". Managers can add cases and assign testers.
- **Run dialog:** step-by-step pass or fail with comments, overall outcome, notes and build, plus File Bug where permitted. File Bug creates a ticket from an editable title, with the case and failed steps as its description, then records it on the result. If saving the result then fails, a retry reuses that ticket. Users who can't create tickets can enter an existing ticket key.
- **Test case page:** plans using the case.

Controls the user has no permission for are hidden; the API still enforces every rule.

## Separate fix

`GET /api/tickets/[key]/comments` has no ticket access check. Fix it in its own commit by applying the same check as `GET /api/tickets/[key]`, including `canSeeViaComment`.

## Testing

- **vitest:** permission denials for each role, ticket privacy, key numbering under concurrency, version bumps only on title, preconditions and steps, stale calculation, bulk results with a bad entry, result transaction, completed plan and deprecated case rejections, suite cycle rejection, duplicate skipping, comment access fix.
- **Phase 1 proof through real MCP:** write a case against a small page, have Claude pick it up and generate a Playwright test, run it, report the result, edit the case, and confirm it shows as stale.
- **Phase 2 MCP end to end on a local build:** create plan and suite, add cases with two configurations, record results as Manager and Employee, read back, check denials.
- **Browser:** library, plan and run flows as Manager and as Employee.
- **Gates:** `tsc` and a clean `next build`. `tests/email.test.ts` already failed on baseline because of env.

## Deployment

For each phase:

1. Commit on a branch and merge. Syncing the `esgincit` fork deploys it.
2. The user runs the migration SQL in the Supabase SQL Editor, because prod DB credentials cannot be pulled. The script is idempotent and records the Prisma migration row.
3. Verify on prod through MCP, then reconnect AI tools.

Until the migration runs, only the new features fail; existing features are unaffected.
